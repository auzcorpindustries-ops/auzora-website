/* =====================================================
   AUZ IT SERVICES — script.js
   Scroll animations, nav behaviour, form handling
   ===================================================== */

// ── NAV: scroll-aware background ─────────────────────
const navbar = document.getElementById('navbar');

function updateNav() {
  if (window.scrollY > 20) {
    navbar.classList.add('scrolled');
  } else {
    navbar.classList.remove('scrolled');
  }
}

window.addEventListener('scroll', updateNav, { passive: true });
updateNav();

// ── NAV: mobile toggle ────────────────────────────────
const navToggle = document.getElementById('navToggle');
const navLinks  = document.getElementById('navLinks');

navToggle.addEventListener('click', () => {
  const open = navLinks.classList.toggle('open');
  navToggle.setAttribute('aria-expanded', open);
  document.body.style.overflow = open ? 'hidden' : '';
});

// Close mobile nav on link click
navLinks.querySelectorAll('a').forEach(link => {
  link.addEventListener('click', () => {
    navLinks.classList.remove('open');
    navToggle.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
  });
});

// ── SCROLL ANIMATIONS (IntersectionObserver) ──────────
const animatedEls = document.querySelectorAll('.animate-on-scroll');

const observer = new IntersectionObserver(
  (entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        // Once visible, stop observing for performance
        observer.unobserve(entry.target);
      }
    });
  },
  {
    threshold: 0.12,
    rootMargin: '0px 0px -40px 0px',
  }
);

animatedEls.forEach(el => observer.observe(el));

// ── ACTIVE NAV LINK (scroll spy) ─────────────────────
const sections = document.querySelectorAll('section[id]');
const navAnchors = document.querySelectorAll('.nav-links a');

const sectionObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const id = entry.target.getAttribute('id');
        navAnchors.forEach(a => {
          a.classList.toggle('active', a.getAttribute('href') === `#${id}`);
        });
      }
    });
  },
  { threshold: 0.4 }
);

sections.forEach(sec => sectionObserver.observe(sec));

// ── CONTACT FORM ──────────────────────────────────────
const form       = document.getElementById('contactForm');
const submitBtn  = document.getElementById('submitBtn');
const formSuccess = document.getElementById('formSuccess');

form.addEventListener('submit', async (e) => {
  e.preventDefault();

  // Basic validation
  const name    = form.name.value.trim();
  const email   = form.email.value.trim();
  const message = form.message.value.trim();

  if (!name || !email || !message) {
    formSuccess.style.color = '#f87171';
    formSuccess.textContent = 'Please fill in all fields.';
    return;
  }

  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRe.test(email)) {
    formSuccess.style.color = '#f87171';
    formSuccess.textContent = 'Please enter a valid email address.';
    return;
  }

  // Simulate async submit
  submitBtn.disabled = true;
  submitBtn.querySelector('.btn-text').textContent = 'Sending…';

  await new Promise(r => setTimeout(r, 1200));

  form.reset();
  formSuccess.style.color = '#22c55e';
  formSuccess.textContent = '✓ Message sent! We\'ll be in touch shortly.';
  submitBtn.disabled = false;
  submitBtn.querySelector('.btn-text').textContent = 'Send Message';
});

// ── SMOOTH PARALLAX on hero orbs (subtle, perf-friendly)
let ticking = false;
const orbs = document.querySelectorAll('.mesh-orb');

window.addEventListener('scroll', () => {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(() => {
    const y = window.scrollY;
    orbs.forEach((orb, i) => {
      const speed = 0.04 + i * 0.015;
      orb.style.transform = `translateY(${y * speed}px)`;
    });
    ticking = false;
  });
}, { passive: true });
