/* Faida landing — shared mobile navigation.
 *
 * index.html carried this inline; the other pages had no hamburger at all, so
 * their nav (marked .hide-mobile) simply vanished below 768px and a phone
 * visitor had no way to move around the site.
 *
 * Defensive on purpose: every page loads this, and not every page has a menu.
 */
(function () {
  'use strict';

  function el(id) { return document.getElementById(id); }

  function setOpen(open) {
    var menu = el('mobile-menu');
    var btn = el('nav-hamburger');
    if (!menu || !btn) return;
    menu.classList.toggle('open', open);
    btn.classList.toggle('open', open);
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    // Stop the page scrolling behind an open overlay.
    document.body.style.overflow = open ? 'hidden' : '';
  }

  window.toggleMobileMenu = function () {
    var menu = el('mobile-menu');
    if (!menu) return;
    setOpen(!menu.classList.contains('open'));
  };

  window.closeMobileMenu = function () { setOpen(false); };

  document.addEventListener('DOMContentLoaded', function () {
    var menu = el('mobile-menu');
    var btn = el('nav-hamburger');
    if (!menu || !btn) return;

    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      window.toggleMobileMenu();
    });

    // Any link closes it, so an in-page anchor does not leave the overlay up.
    menu.addEventListener('click', function (e) {
      if (e.target.closest('a')) window.closeMobileMenu();
    });

    document.addEventListener('click', function (e) {
      if (!menu.classList.contains('open')) return;
      if (menu.contains(e.target) || btn.contains(e.target)) return;
      window.closeMobileMenu();
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') window.closeMobileMenu();
    });

    // Rotating to landscape can cross the breakpoint with the menu still open,
    // which would otherwise leave a fixed overlay covering a desktop layout.
    window.addEventListener('resize', function () {
      if (window.innerWidth > 768) window.closeMobileMenu();
    });
  });
})();
