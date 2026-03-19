const params = new URLSearchParams(window.location.search);
const returnTo = params.get('return') || '/';

if ('scrollRestoration' in window.history) {
  window.history.scrollRestoration = 'manual';
}

window.requestAnimationFrame(() => {
  window.requestAnimationFrame(() => {
    window.setTimeout(() => {
      window.location.replace(returnTo);
    }, 60);
  });
});
