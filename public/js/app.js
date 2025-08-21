document.addEventListener('DOMContentLoaded', () => {
  // Reveal animation on scroll
  const reveals = Array.from(document.querySelectorAll('.reveal'));
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (e.isIntersecting) e.target.classList.add('revealed');
    });
  }, { rootMargin: '0px 0px -10% 0px', threshold: 0.05 });
  reveals.forEach((el) => io.observe(el));

  // Copy buttons
  document.querySelectorAll('[data-copy]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const selector = btn.getAttribute('data-copy');
      const target = document.querySelector(selector);
      if (!target) return;
      const text = target.innerText || target.textContent || '';
      try {
        await navigator.clipboard.writeText(text);
        btn.textContent = 'Copiado ✓';
        setTimeout(() => (btn.textContent = 'Copiar'), 1200);
      } catch (_) {
        // ignore
      }
    });
  });
});

