(() => {
  "use strict";

  const STORAGE_PREFIX = "study-notes:v1:";
  const LAST_NOTE_KEY = `${STORAGE_PREFIX}last-note`;
  const elements = {
    reader: document.querySelector("#reader"),
    document: document.querySelector("#document"),
    loading: document.querySelector("#loading"),
    error: document.querySelector("#error"),
    noteList: document.querySelector("#note-list"),
    search: document.querySelector("#note-search"),
    previous: document.querySelector("#previous-note"),
    next: document.querySelector("#next-note"),
    progressBar: document.querySelector("#progress-bar"),
    progressLabel: document.querySelector("#progress-label"),
    library: document.querySelector("#library"),
    libraryToggle: document.querySelector("#library-toggle"),
    libraryClose: document.querySelector("#library-close"),
    outline: document.querySelector("#outline-panel"),
    outlineList: document.querySelector("#outline-list"),
    outlineToggle: document.querySelector("#outline-toggle"),
    outlineClose: document.querySelector("#outline-close"),
    backdrop: document.querySelector("#backdrop"),
    offlineStatus: document.querySelector("#offline-status")
  };

  let notes = [];
  let currentIndex = -1;
  let headings = [];
  let saveTimer;
  let restoring = false;

  function storageKey(path) {
    return `${STORAGE_PREFIX}position:${path}`;
  }

  function slugify(value) {
    return value
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-") || "section";
  }

  function setPanel(panel, open) {
    const isLibrary = panel === elements.library;
    panel.classList.toggle("open", open);
    (isLibrary ? elements.libraryToggle : elements.outlineToggle)
      .setAttribute("aria-expanded", String(open));
    const anotherOpen = isLibrary
      ? elements.outline.classList.contains("open")
      : elements.library.classList.contains("open");
    elements.backdrop.hidden = !(open || anotherOpen);
  }

  function closePanels() {
    setPanel(elements.library, false);
    setPanel(elements.outline, false);
  }

  function renderLibrary(filter = "") {
    const query = filter.trim().toLowerCase();
    elements.noteList.replaceChildren();
    notes.forEach((note, index) => {
      if (query && !note.title.toLowerCase().includes(query)) {
        return;
      }
      const link = document.createElement("a");
      link.href = `?note=${encodeURIComponent(note.path)}`;
      link.textContent = note.title;
      link.dataset.index = String(index);
      if (index === currentIndex) {
        link.setAttribute("aria-current", "page");
      }
      link.addEventListener("click", event => {
        event.preventDefault();
        openNote(index, true);
        closePanels();
      });
      elements.noteList.append(link);
    });
  }

  function assignHeadingIds() {
    const counts = new Map();
    headings = Array.from(elements.document.querySelectorAll("h1, h2, h3, h4"));
    headings.forEach(heading => {
      const base = slugify(heading.textContent || "");
      const count = counts.get(base) || 0;
      counts.set(base, count + 1);
      heading.id = count === 0 ? base : `${base}-${count + 1}`;
    });
  }

  function renderOutline() {
    elements.outlineList.replaceChildren();
    headings.forEach(heading => {
      const link = document.createElement("a");
      link.href = `#${heading.id}`;
      link.textContent = heading.textContent;
      link.dataset.level = heading.tagName.slice(1);
      link.addEventListener("click", event => {
        event.preventDefault();
        heading.scrollIntoView({ behavior: "smooth", block: "start" });
        history.replaceState(null, "", `?note=${encodeURIComponent(notes[currentIndex].path)}#${heading.id}`);
        setPanel(elements.outline, false);
      });
      elements.outlineList.append(link);
    });
  }

  function resolveDocumentLinks() {
    const currentPath = notes[currentIndex].path;
    const currentUrl = new URL(currentPath, location.href);
    elements.document.querySelectorAll("a[href]").forEach(link => {
      const rawHref = link.getAttribute("href");
      if (!rawHref || rawHref.startsWith("#")) {
        return;
      }
      const resolved = new URL(rawHref, currentUrl);
      if (resolved.origin === location.origin && resolved.pathname.toLowerCase().endsWith(".md")) {
        const baseUrl = new URL(".", location.href);
        const path = decodeURIComponent(resolved.pathname.slice(baseUrl.pathname.length));
        const targetIndex = notes.findIndex(note => note.path === path);
        if (targetIndex >= 0) {
          link.href = `?note=${encodeURIComponent(path)}${resolved.hash}`;
          link.addEventListener("click", event => {
            event.preventDefault();
            openNote(targetIndex, true, resolved.hash.slice(1));
          });
        }
      } else if (resolved.origin !== location.origin) {
        link.target = "_blank";
        link.rel = "noopener noreferrer";
      }
    });
    elements.document.querySelectorAll("img[src]").forEach(image => {
      const rawSource = image.getAttribute("src");
      if (rawSource && !rawSource.startsWith("data:")) {
        image.src = new URL(rawSource, currentUrl).href;
        image.loading = "lazy";
      }
    });
  }

  function getScrollMetrics() {
    const reader = elements.reader;
    const mobile = matchMedia("(max-width: 720px)").matches;
    const scrollTop = mobile ? window.scrollY : reader.scrollTop;
    const viewport = mobile ? window.innerHeight : reader.clientHeight;
    const fullHeight = mobile ? document.documentElement.scrollHeight : reader.scrollHeight;
    return {
      scrollTop,
      viewport,
      maxScroll: Math.max(0, fullHeight - viewport)
    };
  }

  function setScrollTop(value) {
    if (matchMedia("(max-width: 720px)").matches) {
      window.scrollTo(0, value);
    } else {
      elements.reader.scrollTop = value;
    }
  }

  function headingPosition(heading) {
    const metrics = getScrollMetrics();
    if (matchMedia("(max-width: 720px)").matches) {
      return heading.getBoundingClientRect().top + metrics.scrollTop;
    }
    return heading.getBoundingClientRect().top - elements.reader.getBoundingClientRect().top + metrics.scrollTop;
  }

  function currentPosition() {
    const metrics = getScrollMetrics();
    const marker = metrics.scrollTop + 24;
    let activeIndex = 0;
    headings.forEach((heading, index) => {
      if (headingPosition(heading) <= marker) {
        activeIndex = index;
      }
    });
    const active = headings[activeIndex];
    const start = active ? headingPosition(active) : 0;
    const next = headings[activeIndex + 1];
    const end = next ? headingPosition(next) : Math.max(start + 1, metrics.maxScroll);
    const sectionProgress = Math.max(0, Math.min(1, (metrics.scrollTop - start) / Math.max(1, end - start)));
    return {
      anchor: active?.id || "",
      sectionProgress,
      progress: metrics.maxScroll ? metrics.scrollTop / metrics.maxScroll : 0
    };
  }

  function savePosition() {
    if (currentIndex < 0 || restoring) {
      return;
    }
    localStorage.setItem(storageKey(notes[currentIndex].path), JSON.stringify(currentPosition()));
  }

  function restorePosition(explicitAnchor = "") {
    restoring = true;
    requestAnimationFrame(() => {
      const raw = localStorage.getItem(storageKey(notes[currentIndex].path));
      let saved;
      try {
        saved = raw ? JSON.parse(raw) : null;
      } catch {
        saved = null;
      }
      const anchor = explicitAnchor || saved?.anchor;
      const target = anchor ? document.getElementById(anchor) : null;
      if (target) {
        const index = headings.indexOf(target);
        const next = headings[index + 1];
        const start = headingPosition(target);
        const end = next ? headingPosition(next) : getScrollMetrics().maxScroll;
        const sectionProgress = explicitAnchor ? 0 : Number(saved?.sectionProgress) || 0;
        const topOffset = matchMedia("(max-width: 720px)").matches ? 68 : 16;
        setScrollTop(Math.max(0, start + Math.max(0, end - start) * sectionProgress - topOffset));
      } else {
        const maxScroll = getScrollMetrics().maxScroll;
        setScrollTop(maxScroll * (Number(saved?.progress) || 0));
      }
      restoring = false;
      updateProgress();
    });
  }

  function updateProgress() {
    if (currentIndex < 0) {
      return;
    }
    const metrics = getScrollMetrics();
    const progress = metrics.maxScroll ? Math.max(0, Math.min(1, metrics.scrollTop / metrics.maxScroll)) : 0;
    const percentage = Math.round(progress * 100);
    elements.progressBar.style.width = `${percentage}%`;
    elements.progressLabel.textContent = `${percentage}%`;

    let activeId = "";
    const marker = metrics.scrollTop + 48;
    headings.forEach(heading => {
      if (headingPosition(heading) <= marker) {
        activeId = heading.id;
      }
    });
    elements.outlineList.querySelectorAll("a").forEach(link => {
      link.classList.toggle("active", link.hash === `#${activeId}`);
    });

    clearTimeout(saveTimer);
    saveTimer = setTimeout(savePosition, 180);
  }

  async function openNote(index, pushHistory = false, explicitAnchor = "") {
    if (index < 0 || index >= notes.length) {
      return;
    }
    savePosition();
    currentIndex = index;
    const note = notes[index];
    localStorage.setItem(LAST_NOTE_KEY, note.path);
    elements.loading.hidden = false;
    elements.loading.textContent = `Loading ${note.title}...`;
    elements.document.hidden = true;
    elements.error.hidden = true;
    elements.previous.disabled = index === 0;
    elements.next.disabled = index === notes.length - 1;
    renderLibrary(elements.search.value);

    if (pushHistory) {
      const hash = explicitAnchor ? `#${encodeURIComponent(explicitAnchor)}` : "";
      history.pushState({ note: note.path }, "", `?note=${encodeURIComponent(note.path)}${hash}`);
    }

    try {
      const response = await fetch(note.path);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const markdown = await response.text();
      const rendered = marked.parse(markdown, {
        gfm: true,
        breaks: false
      });
      elements.document.innerHTML = DOMPurify.sanitize(rendered, {
        USE_PROFILES: { html: true },
        FORBID_TAGS: ["style", "iframe", "object", "embed", "form"],
        FORBID_ATTR: ["style"]
      });
      assignHeadingIds();
      resolveDocumentLinks();
      renderOutline();
      elements.loading.hidden = true;
      elements.document.hidden = false;
      document.title = `${note.title} - Study Notes`;
      restorePosition(explicitAnchor || decodeURIComponent(location.hash.slice(1)));
    } catch (error) {
      elements.loading.hidden = true;
      elements.error.hidden = false;
      elements.error.textContent = `Could not open "${note.title}". Connect once to cache this note, then try again. (${error.message})`;
    }
  }

  async function initialize() {
    try {
      const response = await fetch("notes-manifest.json");
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const manifest = await response.json();
      notes = Array.isArray(manifest.notes) ? manifest.notes : [];
      if (!notes.length) {
        throw new Error("No Markdown notes were found");
      }
      renderLibrary();
      const queryPath = new URLSearchParams(location.search).get("note");
      const lastPath = localStorage.getItem(LAST_NOTE_KEY);
      const initialPath = queryPath || lastPath;
      const initialIndex = Math.max(0, notes.findIndex(note => note.path === initialPath));
      await openNote(initialIndex, false);
    } catch (error) {
      elements.loading.hidden = true;
      elements.error.hidden = false;
      elements.error.textContent = `Could not load the note library. (${error.message})`;
    }
  }

  elements.search.addEventListener("input", () => renderLibrary(elements.search.value));
  elements.previous.addEventListener("click", () => openNote(currentIndex - 1, true));
  elements.next.addEventListener("click", () => openNote(currentIndex + 1, true));
  elements.libraryToggle.addEventListener("click", () => setPanel(elements.library, true));
  elements.libraryClose.addEventListener("click", () => setPanel(elements.library, false));
  elements.outlineToggle.addEventListener("click", () => setPanel(elements.outline, true));
  elements.outlineClose.addEventListener("click", () => setPanel(elements.outline, false));
  elements.backdrop.addEventListener("click", closePanels);
  elements.reader.addEventListener("scroll", updateProgress, { passive: true });
  window.addEventListener("scroll", updateProgress, { passive: true });
  window.addEventListener("resize", updateProgress);
  window.addEventListener("beforeunload", savePosition);
  window.addEventListener("popstate", () => {
    const path = new URLSearchParams(location.search).get("note");
    const index = notes.findIndex(note => note.path === path);
    openNote(index >= 0 ? index : 0, false, decodeURIComponent(location.hash.slice(1)));
  });
  window.addEventListener("online", () => {
    elements.offlineStatus.hidden = true;
  });
  window.addEventListener("offline", () => {
    elements.offlineStatus.hidden = false;
  });
  elements.offlineStatus.hidden = navigator.onLine;

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("service-worker.js").catch(error => {
        console.error("Service worker registration failed", error);
      });
    });
  }

  initialize();
})();
