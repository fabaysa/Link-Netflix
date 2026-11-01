document.getElementById('navPackages').addEventListener('click', () => {
  document.getElementById('tabBtnPackages').click();
  document.querySelector('.tabs-nav').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
});
const tabs = [...document.querySelectorAll('.tab-btn')];
function syncTabs() {
  tabs.forEach(tab => { tab.setAttribute('aria-pressed', String(tab.classList.contains('active'))); tab.setAttribute('aria-controls', tab.dataset.tab); });
  document.querySelector('.claim-workspace').classList.toggle('wide-panel', document.getElementById('tabPackages').classList.contains('active'));
}
tabs.forEach(tab => tab.addEventListener('click', syncTabs));
syncTabs();
document.querySelectorAll('.faq-question').forEach(question => {
  question.setAttribute('role', 'button'); question.tabIndex = 0;
  question.setAttribute('aria-expanded', 'false');
  question.addEventListener('click', () => question.setAttribute('aria-expanded', String(question.parentElement.classList.contains('open'))));
  question.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); question.click(); } });
});
