'use strict';

const path = require('path');
const fs = require('fs');
const express = require('express');
const session = require('express-session');
const Database = require('better-sqlite3');
const slugify = require('slugify');
const dotenv = require('dotenv');
const methodOverride = require('method-override');
const expressLayouts = require('express-ejs-layouts');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

// Database setup: move to ./db/data.db
const dbDirectoryPath = path.join(__dirname, 'db');
if (!fs.existsSync(dbDirectoryPath)) {
  fs.mkdirSync(dbDirectoryPath, { recursive: true });
}
const oldDbPath = path.join(__dirname, 'data.db');
const newDbPath = path.join(dbDirectoryPath, 'data.db');
try {
  if (fs.existsSync(oldDbPath) && !fs.existsSync(newDbPath)) {
    fs.renameSync(oldDbPath, newDbPath);
  }
} catch (e) {
  // ignore any migration error
}
const db = new Database(newDbPath);
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS scripts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  code TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  category_id INTEGER,
  FOREIGN KEY(category_id) REFERENCES categories(id)
);
`);

// Express setup
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(expressLayouts);
app.set('layout', 'layout');
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(methodOverride('_method'));

app.use(
  session({
    secret: process.env.SESSION_SECRET || 'dev_secret',
    resave: false,
    saveUninitialized: false,
  })
);

// Inject shared locals
app.use((req, res, next) => {
  try {
    res.locals.categories = db.prepare('SELECT * FROM categories ORDER BY name').all();
  } catch (e) {
    res.locals.categories = [];
  }
  next();
});

// Helpers
function generateSlug(text) {
  return slugify(text, { lower: true, strict: true });
}

function requireAuth(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  return res.redirect('/admin/login');
}

// Seed default category if none
const categoryCount = db.prepare('SELECT COUNT(*) as c FROM categories').get().c;
if (categoryCount === 0) {
  const defaultCategories = ['Combat', 'Utilidades', 'Teleport', 'UI', 'Misceláneo'];
  const insertCat = db.prepare('INSERT INTO categories (name, slug) VALUES (?, ?)');
  const trx = db.transaction((cats) => {
    for (const name of cats) insertCat.run(name, generateSlug(name));
  });
  trx(defaultCategories);
}

// Public routes
app.get('/', (req, res) => {
  const scripts = db
    .prepare(
      `SELECT s.*, c.name as category_name, c.slug as category_slug
       FROM scripts s
       LEFT JOIN categories c ON c.id = s.category_id
       ORDER BY s.created_at DESC`
    )
    .all();
  res.render('home', { title: 'Inicio', scripts });
});

app.get('/categoria/:slug', (req, res) => {
  const category = db.prepare('SELECT * FROM categories WHERE slug = ?').get(req.params.slug);
  if (!category) return res.status(404).render('404');
  const scripts = db
    .prepare(
      `SELECT s.*, c.name as category_name, c.slug as category_slug
       FROM scripts s
       LEFT JOIN categories c ON c.id = s.category_id
       WHERE s.category_id = ?
       ORDER BY s.created_at DESC`
    )
    .all(category.id);
  res.render('category', { title: category.name, category, scripts });
});

app.get('/script/:slug', (req, res) => {
  const script = db
    .prepare(
      `SELECT s.*, c.name as category_name, c.slug as category_slug
       FROM scripts s
       LEFT JOIN categories c ON c.id = s.category_id
       WHERE s.slug = ?`
    )
    .get(req.params.slug);
  if (!script) return res.status(404).render('404');
  res.render('script', { title: script.title, script });
});

// Admin auth
app.get('/admin/login', (req, res) => {
  res.render('admin/login', { error: null });
});

app.post('/admin/login', async (req, res) => {
  const adminUser = process.env.ADMIN_USER || 'admin';
  const adminPass = process.env.ADMIN_PASS || 'admin123';
  const { username, password } = req.body;
  if (!username || !password) return res.render('admin/login', { error: 'Credenciales inválidas' });

  const usernameOk = username === adminUser;
  const passwordOk = password === adminPass;
  // Note: for simplicity using plain comparison. For production, hash in env or DB.

  if (usernameOk && passwordOk) {
    req.session.isAdmin = true;
    return res.redirect('/admin');
  }
  return res.render('admin/login', { error: 'Usuario o contraseña incorrectos' });
});

app.post('/admin/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

// Admin dashboard
app.get('/admin', requireAuth, (req, res) => {
  const scripts = db
    .prepare(
      `SELECT s.*, c.name as category_name
       FROM scripts s
       LEFT JOIN categories c ON c.id = s.category_id
       ORDER BY s.created_at DESC`
    )
    .all();
  const categories = db.prepare('SELECT * FROM categories ORDER BY name').all();
  res.render('admin/dashboard', { title: 'Admin', categories, scripts });
});

// Category CRUD (admin)
app.post('/admin/categories', requireAuth, (req, res) => {
  const { name } = req.body;
  if (!name || name.trim().length === 0) return res.redirect('/admin');
  const slug = generateSlug(name);
  try {
    db.prepare('INSERT INTO categories (name, slug) VALUES (?, ?)').run(name.trim(), slug);
  } catch (e) {
    // ignore duplicates
  }
  res.redirect('/admin');
});

app.post('/admin/categories/:id/delete', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  db.prepare('DELETE FROM categories WHERE id = ?').run(id);
  res.redirect('/admin');
});

// Script CRUD (admin)
app.get('/admin/scripts/new', requireAuth, (req, res) => {
  const categories = db.prepare('SELECT * FROM categories ORDER BY name').all();
  res.render('admin/new_script', { title: 'Nuevo script', categories });
});

app.post('/admin/scripts', requireAuth, (req, res) => {
  const { title, description, code, category_id } = req.body;
  if (!title || !code) return res.redirect('/admin');
  const slug = generateSlug(title);
  const now = new Date().toISOString();
  db
    .prepare(
      `INSERT INTO scripts (title, slug, description, code, created_at, updated_at, category_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(title, slug, description || '', code, now, now, category_id || null);
  res.redirect('/admin');
});

app.get('/admin/scripts/:id/edit', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const script = db.prepare('SELECT * FROM scripts WHERE id = ?').get(id);
  if (!script) return res.redirect('/admin');
  const categories = db.prepare('SELECT * FROM categories ORDER BY name').all();
  res.render('admin/edit_script', { title: 'Editar script', script, categories });
});

app.post('/admin/scripts/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const { title, description, code, category_id } = req.body;
  const slug = generateSlug(title);
  const now = new Date().toISOString();
  db
    .prepare(
      `UPDATE scripts SET title = ?, slug = ?, description = ?, code = ?, updated_at = ?, category_id = ? WHERE id = ?`
    )
    .run(title, slug, description || '', code, now, category_id || null, id);
  res.redirect('/admin');
});

app.post('/admin/scripts/:id/delete', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  db.prepare('DELETE FROM scripts WHERE id = ?').run(id);
  res.redirect('/admin');
});

// 404
app.use((req, res) => {
  res.status(404).render('404');
});

app.listen(PORT, HOST, () => {
  // eslint-disable-next-line no-console
  console.log(`Servidor escuchando en http://${HOST}:${PORT}`);
});

