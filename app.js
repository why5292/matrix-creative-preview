(() => {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const language = document.body.dataset.lang || document.documentElement.lang || 'en';
  const fallbackCopy = {
    project_count: '{count} projects',
    open_menu: 'Open menu',
    close_menu: 'Close menu',
    play: 'Play',
    pause: 'Pause',
    replay: 'Replay',
    loading: 'Loading…',
    retry: 'Try again',
    resume: 'Resume',
    playing: 'Playing',
    paused: 'Paused',
    ended: 'Playback finished',
    video_error: 'The video is unavailable. The photograph is still visible.',
    video_prompt: 'Select play to watch.'
  };
  let suppliedCopy = {};
  try {
    const parsed = JSON.parse($('#ui-copy')?.textContent || '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      suppliedCopy = Object.fromEntries(Object.entries(parsed).filter(([, value]) => typeof value === 'string'));
    }
  } catch {
    // Static page content and essential controls remain available if copy is malformed.
  }
  const ui = Object.freeze({ ...fallbackCopy, ...suppliedCopy });

  $$('select[data-language-switch]').forEach(select => select.addEventListener('change', () => {
    const option = select.selectedOptions[0];
    if (!option?.value) return;
    let destination;
    try {
      const current = new URL(window.location.href);
      destination = new URL(option.value, current);
      if (current.searchParams.has('category')) destination.searchParams.set('category', current.searchParams.get('category'));
      else destination.searchParams.delete('category');
      destination.hash = current.hash;
    } catch {
      return;
    }
    try {
      if (option.dataset.lang) window.localStorage.setItem('matrix-language', option.dataset.lang);
    } catch {
      // Storage can be unavailable in private or local-file sessions; routing still works.
    }
    window.location.assign(destination.href);
  }));

  const gsap = window.gsap;
  const ScrollTrigger = window.ScrollTrigger;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const desktop = window.matchMedia('(min-width: 900px) and (pointer: fine)');
  const motionButtons = $$('[data-motion-toggle]');
  const dialogFocus = new WeakMap();
  let userPaused = false;
  let processTween;
  const revealAnimations = [];
  const revealTriggers = [];
  const revealed = new WeakSet();
  const imageLoads = new Map();
  const isMotionOff = () => reduced.matches || userPaused;
  const pageBlocked = () => document.hidden || !!$('dialog[open]');

  // Decode replacement photographs before changing the visible frame.
  function prepareImage(source) {
    if (!imageLoads.has(source)) {
      const ready = new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => {
          if (image.decode) image.decode().catch(() => {}).then(resolve);
          else resolve();
        };
        image.onerror = reject;
        image.src = source;
      }).catch(error => {
        imageLoads.delete(source);
        throw error;
      });
      imageLoads.set(source, ready);
    }
    return imageLoads.get(source);
  }

  if (gsap && ScrollTrigger) gsap.registerPlugin(ScrollTrigger);

  // Keep the navigation fully usable without animation or a third-party library.
  const menu = $('[data-menu]');
  const navigation = $('#navigation');
  function setMenu(open) {
    if (!menu || !navigation) return;
    menu.setAttribute('aria-expanded', String(open));
    navigation.classList.toggle('is-open', open);
    document.body.classList.toggle('menu-open', open);
    menu.setAttribute('aria-label', open ? ui.close_menu : ui.open_menu);
  }
  menu?.addEventListener('click', () => setMenu(menu.getAttribute('aria-expanded') !== 'true'));
  $$('a', navigation || document.createElement('div')).forEach(link => link.addEventListener('click', () => setMenu(false)));
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && menu?.getAttribute('aria-expanded') === 'true') {
      setMenu(false);
      menu.focus();
    }
  });
  window.matchMedia('(min-width: 701px)').addEventListener('change', event => {
    if (event.matches) setMenu(false);
  });

  function openDialog(dialog, trigger) {
    if (!dialog) return;
    setMenu(false);
    dialogFocus.set(dialog, trigger || document.activeElement);
    if (!dialog.open) dialog.showModal();
    document.body.classList.add('dialog-open');
    syncMotion();
  }
  function closeDialog(dialog) {
    if (dialog?.open) dialog.close();
  }
  $$('dialog').forEach(dialog => {
    dialog.addEventListener('close', () => {
      document.body.classList.toggle('dialog-open', !!$('dialog[open]'));
      const trigger = dialogFocus.get(dialog);
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
      syncMotion();
    });
    dialog.addEventListener('click', event => {
      if (event.target !== dialog) return;
      const bounds = dialog.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) closeDialog(dialog);
    });
    $$('[data-close]', dialog).forEach(button => button.addEventListener('click', () => closeDialog(dialog)));
  });
  // Reveals never hide content when motion is disabled, on mobile, or without GSAP.
  function clearReveals() {
    revealTriggers.splice(0).forEach(trigger => trigger.kill());
    revealAnimations.splice(0).forEach(animation => animation.kill());
    $$('[data-reveal]').forEach(element => {
      if (gsap) gsap.set(element, { clearProps: 'transform,opacity,visibility' });
      else {
        element.style.opacity = '1';
        element.style.visibility = 'visible';
      }
    });
  }
  function setupReveals() {
    clearReveals();
    if (!gsap || !ScrollTrigger || isMotionOff() || !desktop.matches) return;
    $$('[data-reveal]').forEach(element => {
      if (revealed.has(element) || element.getBoundingClientRect().top < window.innerHeight * 0.92) {
        revealed.add(element);
        return;
      }
      gsap.set(element, { autoAlpha: 0, y: 24 });
      const trigger = ScrollTrigger.create({
        trigger: element,
        start: 'top 92%',
        once: true,
        onEnter: () => {
          revealed.add(element);
          revealAnimations.push(gsap.to(element, { autoAlpha: 1, y: 0, duration: 0.75, ease: 'power2.out', clearProps: 'transform,opacity,visibility' }));
        }
      });
      revealTriggers.push(trigger);
    });
    ScrollTrigger.refresh();
  }
  $$('.project-media').forEach(media => {
    const image = $('img', media);
    // Preserve full branded source images, including marks at their edges.
    if (!image || media.classList.contains('preserve') || image.classList.contains('preserve')) return;
    media.addEventListener('pointerenter', () => {
      if (gsap && !isMotionOff() && desktop.matches && !pageBlocked()) gsap.to(image, { scale: 1.03, duration: 0.65, ease: 'power2.out', overwrite: true });
    });
    media.addEventListener('pointerleave', () => {
      if (gsap) gsap.to(image, { scale: 1, duration: isMotionOff() ? 0 : 0.5, ease: 'power2.out', overwrite: true });
    });
  });

  const workGrid = $('#work-grid');
  const filterButtons = $$('[data-filter]');
  function filterWorks(category, updateURL = false) {
    if (!workGrid) return;
    const allowed = filterButtons.map(button => button.dataset.filter);
    const chosen = allowed.includes(category) ? category : 'all';
    let count = 0;
    $$('.project-card', workGrid).forEach(card => {
      const visible = chosen === 'all' || (card.dataset.categories || '').split(/\s+/).includes(chosen);
      card.hidden = !visible;
      if (visible) count += 1;
    });
    filterButtons.forEach(button => {
      const selected = button.dataset.filter === chosen;
      button.classList.toggle('is-active', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
    const output = $('#result-count');
    if (output) output.textContent = ui.project_count.replaceAll('{count}', String(count).padStart(2, '0'));
    if (updateURL) {
      const url = new URL(window.location.href);
      if (chosen === 'all') url.searchParams.delete('category');
      else url.searchParams.set('category', chosen);
      if (url.href !== window.location.href) window.history.pushState({}, '', url);
    }
    ScrollTrigger?.refresh();
  }
  filterButtons.forEach(button => button.addEventListener('click', () => filterWorks(button.dataset.filter, true)));
  window.addEventListener('popstate', () => filterWorks(new URLSearchParams(location.search).get('category') || 'all'));
  $$('[data-view]').forEach(button => button.addEventListener('click', () => {
    if (!workGrid) return;
    const index = button.dataset.view === 'index';
    workGrid.classList.toggle('is-index', index);
    $$('[data-view]').forEach(control => control.setAttribute('aria-pressed', String(control.dataset.view === (index ? 'index' : 'grid'))));
    ScrollTrigger?.refresh();
  }));

  const lightbox = $('#lightbox');
  const galleryLinks = $$('[data-lightbox]');
  let galleryIndex = 0;
  let touchX;
  let touchY;
  function showGallery(index) {
    if (!galleryLinks.length) return;
    galleryIndex = (index + galleryLinks.length) % galleryLinks.length;
    const link = galleryLinks[galleryIndex];
    const image = $('#lightbox-image');
    const caption = link.dataset.caption || $('img', link)?.alt || '';
    if (image) {
      image.src = link.href;
      image.alt = caption;
    }
    if ($('#lightbox-caption')) $('#lightbox-caption').textContent = caption;
    if ($('#lightbox-count')) $('#lightbox-count').textContent = `${galleryIndex + 1} / ${galleryLinks.length}`;
  }
  galleryLinks.forEach((link, index) => link.addEventListener('click', event => {
    if (!lightbox) return;
    event.preventDefault();
    showGallery(index);
    openDialog(lightbox, link);
  }));
  $$('[data-gallery]').forEach(button => button.addEventListener('click', () => showGallery(galleryIndex + (button.dataset.gallery === 'prev' ? -1 : 1))));
  lightbox?.addEventListener('keydown', event => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      showGallery(galleryIndex + (event.key === 'ArrowLeft' ? -1 : 1));
    }
  });
  lightbox?.addEventListener('touchstart', event => {
    touchX = event.changedTouches[0].clientX;
    touchY = event.changedTouches[0].clientY;
  }, { passive: true });
  lightbox?.addEventListener('touchend', event => {
    if (touchX === undefined) return;
    const x = event.changedTouches[0].clientX - touchX;
    const y = event.changedTouches[0].clientY - touchY;
    if (Math.abs(x) > 55 && Math.abs(x) > Math.abs(y)) showGallery(galleryIndex + (x < 0 ? 1 : -1));
    touchX = undefined;
  }, { passive: true });

  const processImage = $('.process-frame img');
  let processRequest = 0;
  $$('[data-process]').forEach(button => button.addEventListener('click', async () => {
    if (!processImage || !button.dataset.image) return;
    const request = ++processRequest;
    processTween?.kill();
    processTween = undefined;
    processImage.style.opacity = '1';
    processImage.parentElement.setAttribute('aria-busy', 'true');
    try {
      await prepareImage(button.dataset.image);
    } catch {
      if (request === processRequest) processImage.parentElement.removeAttribute('aria-busy');
      return;
    }
    if (request !== processRequest) return;
    processImage.parentElement.removeAttribute('aria-busy');
    $$('[data-process]').forEach(control => {
      const current = control === button;
      control.classList.toggle('is-active', current);
      control.setAttribute('aria-pressed', String(current));
    });
    const replace = () => {
      processImage.src = button.dataset.image;
      processImage.removeAttribute('srcset');
      processImage.removeAttribute('sizes');
      processImage.alt = button.dataset.alt || button.dataset.caption || '';
      if ($('#process-caption')) $('#process-caption').textContent = button.dataset.caption || '';
    };
    if (gsap && !isMotionOff() && !pageBlocked()) {
      processTween = gsap.timeline({ onComplete: () => { processTween = undefined; } }).to(processImage, { opacity: 0, duration: 0.18 }).call(replace).to(processImage, { opacity: 1, duration: 0.4, ease: 'power1.out' });
    } else {
      replace();
      processImage.style.opacity = '1';
    }
  }));

  // The homepage film starts muted and loops; an explicit pause always wins.
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  const filmButtons = $$('[data-film-toggle]');
  function filmIsVisible(video) {
    const rect = video.getBoundingClientRect();
    return rect.bottom > 0 && rect.top < window.innerHeight &&
      rect.right > 0 && rect.left < window.innerWidth;
  }
  const filmStates = $$('[data-feature-film]').map((video, index) => ({
    video,
    button: filmButtons[index] || null,
    label: filmButtons[index]?.querySelector('[data-film-label]'),
    icon: filmButtons[index]?.querySelector('[data-film-icon]'),
    output: index === 0 ? $('#film-state') : null,
    phase: 'poster',
    visible: filmIsVisible(video),
    autoAttempted: false,
    requested: false,
    sourceAttached: video.hasAttribute('src'),
    manualPaused: false,
    autoBlocked: false,
    token: 0,
    message: ''
  }));

  function renderFilm(state) {
    const active = state.phase === 'playing' || state.phase === 'loading';
    const text = state.phase === 'loading' ? ui.loading
      : state.phase === 'playing' ? ui.pause
        : state.phase === 'ended' ? ui.replay
          : state.phase === 'error' ? ui.retry
            : state.video.currentTime > 0 ? ui.resume : ui.play;
    if (state.label) state.label.textContent = text;
    if (state.icon) state.icon.textContent = active ? 'Ⅱ' : '▶';
    if (state.button) {
      state.button.setAttribute('aria-label', text);
      state.button.setAttribute('aria-pressed', String(active));
      state.button.setAttribute('aria-busy', String(state.phase === 'loading'));
    }
    state.video.dataset.filmState = state.phase;
    state.video.classList.toggle('is-playing', state.phase === 'playing');
    state.video.classList.toggle('is-loading', state.phase === 'loading');
    if (state.output) state.output.textContent = state.message || (
      state.phase === 'loading' ? ui.loading
        : state.phase === 'playing' ? ui.playing
          : state.phase === 'ended' ? ui.ended
            : state.phase === 'paused' ? ui.paused
              : ui.video_prompt
    );
  }

  function pauseFilm(state, reason = 'user') {
    if (reason === 'user') state.manualPaused = true;
    if (!state.requested && state.video.paused) return;
    state.token += 1;
    state.requested = false;
    state.autoAttempted = true;
    state.video.pause();
    state.phase = state.video.ended ? 'ended' : 'paused';
    state.message = reason === 'hidden' ? ui.paused : '';
    renderFilm(state);
  }

  function failFilm(state) {
    state.token += 1;
    state.requested = false;
    state.autoAttempted = true;
    state.phase = 'error';
    state.message = ui.video_error;
    state.video.pause();
    state.video.classList.remove('has-frame');
    state.sourceAttached = false;
    state.video.removeAttribute('src');
    state.video.load();
    renderFilm(state);
  }

  function showFilmFrame(state) {
    // Native autoplay can start before this controller or its observer is ready.
    state.visible = filmIsVisible(state.video);
    if (state.manualPaused || userPaused || pageBlocked() || !state.visible) {
      pauseFilm(state, 'hidden');
      return;
    }
    state.requested = true;
    state.phase = 'playing';
    state.message = '';
    state.video.classList.add('has-frame');
    renderFilm(state);
  }

  async function playFilm(state, manual = false) {
    if (pageBlocked() || state.requested) return;
    if (manual) {
      state.manualPaused = false;
      state.autoBlocked = false;
    }
    const source = state.video.dataset.src;
    if (!source) {
      failFilm(state);
      return;
    }
    const token = ++state.token;
    state.autoAttempted = true;
    state.requested = true;
    state.message = '';
    const replay = state.phase === 'ended' || state.video.ended;
    state.phase = 'loading';
    state.video.muted = true;
    state.video.loop = state.video.hasAttribute('data-auto-film');
    state.video.playsInline = true;
    if (!state.sourceAttached) {
      state.video.src = source;
      state.video.preload = 'metadata';
      state.sourceAttached = true;
      state.video.load();
    } else if (replay) {
      state.video.currentTime = 0;
    }
    renderFilm(state);
    try {
      await state.video.play();
      if (state.token !== token) return;
      if (!state.requested) state.video.pause();
      else if (!state.video.paused) showFilmFrame(state);
    } catch (error) {
      if (state.token !== token || !state.requested) return;
      if (error.name === 'NotAllowedError' || error.name === 'AbortError') {
        state.requested = false;
        // Do not keep retrying a browser's autoplay refusal.
        state.autoBlocked = true;
        state.phase = 'paused';
        state.message = manual ? ui.retry : ui.video_prompt;
        renderFilm(state);
      } else {
        failFilm(state);
      }
    }
  }

  function maybeAutoPlayFilm(state) {
    if (state.video.hasAttribute('data-auto-film') &&
      !userPaused && !state.manualPaused && !state.autoBlocked &&
      !pageBlocked() && state.visible && !state.requested &&
      (state.phase === 'poster' || state.phase === 'paused')) {
      playFilm(state);
    }
  }

  filmStates.forEach(state => {
    const video = state.video;
    video.loop = video.hasAttribute('data-auto-film');
    video.muted = true;
    video.defaultMuted = true;
    state.button?.addEventListener('click', () => {
      if (state.requested || !video.paused) pauseFilm(state);
      else playFilm(state, true);
    });
    video.addEventListener('playing', () => showFilmFrame(state));
    video.addEventListener('waiting', () => {
      if (!state.requested) return;
      state.phase = 'loading';
      renderFilm(state);
    });
    video.addEventListener('pause', () => {
      if (!video.paused) return;
      if (state.phase === 'error' || state.phase === 'poster') return;
      state.requested = false;
      state.autoAttempted = true;
      state.phase = video.ended ? 'ended' : 'paused';
      renderFilm(state);
    });
    video.addEventListener('ended', () => {
      state.requested = false;
      state.autoAttempted = true;
      state.phase = 'ended';
      state.message = '';
      renderFilm(state);
    });
    video.addEventListener('error', () => { if (state.sourceAttached) failFilm(state); });
    renderFilm(state);
  });

  if ('IntersectionObserver' in window) {
    const filmVisibility = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        const state = filmStates.find(item => item.video === entry.target);
        state.visible = entry.isIntersecting && entry.intersectionRatio >= 0.08;
        if (!state.visible) pauseFilm(state, 'hidden');
        else maybeAutoPlayFilm(state);
      });
    }, { threshold: [0, 0.08] });
    filmStates.forEach(state => filmVisibility.observe(state.video));
  } else {
    const checkFilms = () => filmStates.forEach(state => {
      const rect = state.video.getBoundingClientRect();
      state.visible = rect.bottom > 0 && rect.top < window.innerHeight;
      if (!state.visible) pauseFilm(state, 'hidden');
      else maybeAutoPlayFilm(state);
    });
    window.addEventListener('scroll', checkFilms, { passive: true });
    window.addEventListener('resize', checkFilms, { passive: true });
    checkFilms();
  }
  function syncMotion() {
    const off = isMotionOff();
    document.documentElement.classList.toggle('motion-paused', off);
    motionButtons.forEach(button => {
      button.textContent = off ? ui.play : ui.pause;
      button.setAttribute('aria-pressed', String(off));
      button.disabled = reduced.matches;
      button.title = reduced.matches ? ui.paused : off ? ui.play : ui.pause;
    });
    if (off || pageBlocked()) {
      revealAnimations.forEach(animation => animation.progress(1));
      processTween?.progress(1);
      if (gsap) $$('.project-media img').forEach(image => {
        gsap.killTweensOf(image);
        gsap.set(image, { clearProps: 'transform' });
      });
    }
    filmStates.forEach(state => {
      if (pageBlocked()) pauseFilm(state, 'hidden');
      else maybeAutoPlayFilm(state);
    });
  }
  motionButtons.forEach(button => button.addEventListener('click', () => {
    userPaused = !userPaused;
    if (userPaused) filmStates.forEach(state => pauseFilm(state));
    syncMotion();
    setupReveals();
  }));
  reduced.addEventListener('change', () => {
    syncMotion();
    setupReveals();
  });
  desktop.addEventListener('change', setupReveals);
  document.addEventListener('visibilitychange', syncMotion);
  window.addEventListener('pageshow', syncMotion);
  filterWorks(new URLSearchParams(location.search).get('category') || 'all');
  syncMotion();
  setupReveals();
  window.addEventListener('load', () => ScrollTrigger?.refresh(), { once: true });
  Object.defineProperty(window, 'matrixV6', {
    value: Object.freeze({
      status: () => Object.freeze({
        language,
        gsap: !!gsap,
        scrollTrigger: !!ScrollTrigger,
        motionPaused: isMotionOff(),
        reducedMotion: reduced.matches,
        saveData: !!connection?.saveData,
        films: filmStates.map(state => Object.freeze({
          phase: state.phase,
          visible: state.visible,
          autoAttempted: state.autoAttempted,
          manualPaused: state.manualPaused,
          autoBlocked: state.autoBlocked,
          sourceAttached: state.sourceAttached,
          requested: state.requested,
          currentTime: state.video.currentTime,
          muted: state.video.muted,
          loop: state.video.loop,
          paused: state.video.paused,
          hasFrame: state.video.classList.contains('has-frame')
        })),
        openDialog: $('dialog[open]')?.id || null
      })
    }),
    writable: false,
    configurable: false
  });
})();
