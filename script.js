const badge = document.querySelector('.word-badge');
let word = document.querySelector('.changing-word');
const variants = [
  { text: 'дизайн', color: '#e2d8ff' },
  { text: 'сайт', color: '#d8ed99' },
  { text: 'брендинг', color: '#f6a180' },
  { text: 'визуал', color: '#b9ddf3' },
];
if (document.body.classList.contains('concept-2')) {
  ['#d3f879', '#b9ddf3', '#f6a180', '#ded5ef'].forEach((color, index) => { variants[index].color = color; });
}
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
// This page explicitly previews the motion requested in the design brief.
const useReducedMotion = () => reducedMotion.matches && document.documentElement.dataset.motion !== 'full';
let current = 0;
let timer;
let changing = false;
function sizeBadge() {
  const style = getComputedStyle(badge);
  badge.style.width = `${word.offsetWidth + parseFloat(style.paddingLeft) + parseFloat(style.paddingRight)}px`;
}
function setLetters(element, text) {
  element.replaceChildren(...Array.from(text, letter => {
    const span = document.createElement('span');
    span.className = 'word-letter';
    span.textContent = letter;
    return span;
  }));
}
setLetters(word, variants[0].text);
async function changeWord() {
  if (document.hidden || changing) return;
  current = (current + 1) % variants.length;
  badge.style.backgroundColor = variants[current].color;
  if (useReducedMotion()) {
    setLetters(word, variants[current].text);
    sizeBadge();
    return;
  }
  changing = true;
  const outgoing = word;
  outgoing.classList.add('is-leaving');
  word = document.createElement('span');
  word.className = 'changing-word';
  setLetters(word, variants[current].text);
  badge.append(word);
  sizeBadge();
  // Overlapping letter waves keep the highlight occupied throughout the transition.
  const animations = [
    ...Array.from(outgoing.children, (letter, index) => letter.animate([
      { transform: 'translateY(0) rotateX(0deg)', opacity: 1 },
      { transform: 'translateY(-58%) rotateX(28deg)', opacity: 0 },
    ], { duration: 520, delay: index * 38, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'both' })),
    ...Array.from(word.children, (letter, index) => letter.animate([
      { transform: 'translateY(65%) rotateX(-32deg)', opacity: 0 },
      { transform: 'translateY(0) rotateX(0deg)', opacity: 1 },
    ], { duration: 850, delay: 140 + index * 44, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'both' })),
  ];
  try {
    await Promise.all(animations.map(animation => animation.finished));
  } finally {
    outgoing.remove();
    animations.forEach(animation => animation.cancel());
    changing = false;
  }
}
document.fonts.ready.then(() => {
  sizeBadge();
  timer = setInterval(changeWord, 2000);
});
window.addEventListener('resize', sizeBadge);
document.addEventListener('visibilitychange', () => {
  clearInterval(timer);
  if (!document.hidden) timer = setInterval(changeWord, 2000);
});
const menuButton = document.querySelector('.menu-toggle');
const mobileNav = document.querySelector('.mobile-nav');
menuButton.addEventListener('click', () => {
  const open = menuButton.getAttribute('aria-expanded') !== 'true';
  menuButton.setAttribute('aria-expanded', String(open));
  menuButton.setAttribute('aria-label', open ? 'Закрыть меню' : 'Открыть меню');
  mobileNav.hidden = !open;
});
mobileNav.addEventListener('click', event => {
  if (event.target.closest('a,button')) { mobileNav.hidden = true; menuButton.setAttribute('aria-expanded', 'false'); menuButton.setAttribute('aria-label', 'Открыть меню'); }
});
const dialog = document.querySelector('.detail-dialog');
const panels = {
  process: '<h2>от идеи к дизайну</h2><p>Обсудим вашу задачу, определим направление и детали проекта.</p><p><a href="mailto:hi@manool.design?subject=Обсудим%20проект">Обсудить проект ↗</a></p>',
  team: '<h2>manool студия</h2><p>Дизайн, сайты, брендинг и визуал.</p><p><a href="mailto:hi@manool.design">Познакомиться ↗</a></p>',
  contact: '<h2>давайте знакомиться</h2><p><a href="mailto:hi@manool.design">hi@manool.design ↗</a></p>',
  project: '<h2>ИНКОМТРАНС</h2><img src="./incom_image.png" alt="Фирменные визитки Инкомтранс"><p><a href="mailto:hi@manool.design?subject=Хочу%20обсудить%20брендинг">Обсудить похожий проект ↗</a></p>',
};
document.querySelectorAll('[data-dialog]').forEach(trigger => trigger.addEventListener('click', event => {
  event.preventDefault();
  document.querySelector('.dialog-content').innerHTML = panels[trigger.dataset.dialog];
  dialog.showModal();
}));
document.querySelector('.dialog-close').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', event => { if (event.target === dialog) { const box = dialog.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.close(); } });

// Animate only the original pupils; eyelids and eye outlines stay in place.
const mascot = document.querySelector('.signature .mascot');
const eyes = Array.from(mascot.querySelectorAll('.mascot-pupil'), pupil => ({
  pupil,
  originX: Number(pupil.dataset.eyeX),
  originY: Number(pupil.dataset.eyeY),
  x: 0, y: 0, targetX: 0, targetY: 0,
}));
let gazeFrame = 0;
let gazeTime = 0;
let pointerPosition = null;

function animateGaze(time) {
  const delta = gazeTime ? Math.min(time - gazeTime, 64) : 16;
  gazeTime = time;
  const ease = useReducedMotion() ? 1 : 1 - Math.exp(-delta / 85);
  let moving = false;
  for (const eye of eyes) {
    eye.x += (eye.targetX - eye.x) * ease;
    eye.y += (eye.targetY - eye.y) * ease;
    const unsettled = Math.abs(eye.targetX - eye.x) + Math.abs(eye.targetY - eye.y) > .05;
    if (!unsettled) { eye.x = eye.targetX; eye.y = eye.targetY; }
    eye.pupil.setAttribute('transform', `translate(${eye.x.toFixed(2)} ${eye.y.toFixed(2)})`);
    moving ||= unsettled;
  }
  gazeFrame = moving ? requestAnimationFrame(animateGaze) : 0;
  if (!moving) gazeTime = 0;
}

function updateGaze() {
  const matrix = mascot.getScreenCTM();
  if (!matrix) return;
  // Inverse SVG coordinates account for the horizontally mirrored mascot.
  const point = pointerPosition
    ? new DOMPoint(pointerPosition.x, pointerPosition.y).matrixTransform(matrix.inverse())
    : null;
  for (const eye of eyes) {
    const dx = point ? point.x - eye.originX : 0;
    const dy = point ? point.y - eye.originY : 0;
    const distance = Math.hypot(dx, dy);
    const strength = Math.min(distance / 500, 1);
    eye.targetX = distance ? dx / distance * 80 * strength : 0;
    eye.targetY = distance ? dy / distance * 55 * strength : 0;
  }
  if (!gazeFrame) gazeFrame = requestAnimationFrame(animateGaze);
}

window.addEventListener('pointermove', event => {
  if (event.pointerType === 'touch') return;
  pointerPosition = { x: event.clientX, y: event.clientY };
  updateGaze();
}, { passive: true });
function resetGaze() { pointerPosition = null; updateGaze(); }
document.documentElement.addEventListener('pointerleave', resetGaze);
window.addEventListener('blur', resetGaze);
window.addEventListener('resize', updateGaze, { passive: true });
window.addEventListener('scroll', updateGaze, { passive: true });
document.addEventListener('visibilitychange', () => { if (document.hidden) resetGaze(); });
