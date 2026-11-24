(() => {
    const viewport = window.visualViewport;
    const root = document.documentElement;
    const app = document.getElementById('app-viewport');
    const screen = document.getElementById('screen-chat');
    const feed = document.getElementById('chat-feed');
    if (!app || !screen || !feed) return;
    let frame = 0, lastHeight = 0, lastTop = 0, keepBottom = false;

    function update() {
        frame = 0;
        const nativeHeight = Number(window.OrbitAndroidVisibleHeight) || 0;
        const top = Math.max(0, Math.round(viewport?.offsetTop || 0));
        const visibleHeight = Math.floor(viewport?.height || innerHeight);
        const focused = document.activeElement?.matches('input,textarea,[contenteditable="true"]');
        const docked = nativeHeight > 0 || (focused && innerHeight - visibleHeight > 80 && Math.abs((viewport?.scale || 1) - 1) < .02);
        const height = docked ? Math.min(visibleHeight, innerHeight, nativeHeight || Infinity) : 0;
        const offset = docked ? top : 0;
        if (height === lastHeight && offset === lastTop) return;
        if (screen.classList.contains('active')) {
            keepBottom ||= feed.scrollHeight - feed.scrollTop - feed.clientHeight < 64;
        }
        lastHeight = height;
        lastTop = offset;
        if (height > 0) {
            app.style.setProperty('--orbit-keyboard-height', height + 'px');
            app.style.setProperty('--orbit-keyboard-top', offset + 'px');
        }
        root.classList.toggle('orbit-visual-keyboard', height > 0);
    }

    function schedule() {
        if (!frame) frame = requestAnimationFrame(update);
    }

    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => {
        if (keepBottom && screen.classList.contains('active')) feed.scrollTop = feed.scrollHeight;
        keepBottom = false;
    }).observe(feed);
    window.orbitUpdateChatViewport = schedule;
    viewport?.addEventListener('resize', schedule);
    viewport?.addEventListener('scroll', schedule);
    window.addEventListener('resize', schedule);
    document.addEventListener('focusin', schedule);
    document.addEventListener('focusout', schedule);
    schedule();
})();
