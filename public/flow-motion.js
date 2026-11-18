/* Editorial, scroll-led motion for public marketing pages only.
   No scroll hijack, tracking, external library, or modification of text content. */
(() => {
  const page = document.body;
  if (!page?.classList.contains("marketing")) return;

  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const data = window.matchMedia("(prefers-reduced-data: reduce)");
  if (!("IntersectionObserver" in window) || motion.matches || data.matches) return;

  const items = new Set();
  const observed = new WeakSet();
  const register = (element, kind = "content", delay = 0) => {
    if (!(element instanceof HTMLElement) || observed.has(element)) return;
    observed.add(element);
    element.classList.add("calvren-flow-item");
    element.dataset.flowKind = kind;
    element.style.setProperty("--flow-delay", Math.max(0, Math.min(320, delay)) + "ms");
    items.add(element);
  };
  const add = (selector, kind, step = 0) => {
    document.querySelectorAll(selector).forEach((element, index) =>
      register(element, kind, step ? (index % 4) * step : 0)
    );
  };

  /* The opening sequence leads with the business outcome, then its proof/video. */
  [
    ".hero-copy .eyebrow", ".hero-copy h1", ".hero-copy .hero-description",
    ".hero-copy .hero-actions", ".hero-copy .hero-cta-note",
    ".hero-copy .hero-reassurance", ".hero-film"
  ].forEach((selector, index) => {
    document.querySelectorAll(selector).forEach(el => register(el, "hero", index * 55));
  });

  /* Section transitions: heading first, content second, cards in sequence. */
  add("main .section-heading .eyebrow", "eyebrow");
  add("main .section-heading h2", "heading");
  add("main .section-heading > p, main .section-heading > div:last-child:not(:first-child)", "content");
  add("#solutions .solutions-intro", "content");
  add("#solutions .solution-card", "card", 100);
  add("#solutions .solutions-action", "panel");
  add("#demo .preview-details > summary", "content");
  add("#pricing .calvren-tier", "card", 95);
  add("#pricing .section-note, #pricing .pricing-details", "content");
  add("#ai-receptionist .receptionist-teaser-copy, #ai-receptionist .receptionist-teaser-price", "panel", 110);
  add("main .faq-list details, main .receptionist-faq details", "card", 65);
  add("main .contact-grid > div:first-child, main .contact-grid > form", "panel", 110);
  add("main .receptionist-hero-copy, main .receptionist-price-card", "panel", 115);
  add("main .receptionist-feature-grid article", "card", 90);
  add("main .receptionist-next > div, main .receptionist-next > a", "content", 115);
  add("main .receptionist-faq > .eyebrow, main .receptionist-faq > h2", "heading");
  add("main .page-hero > div, main .contact-bottom > div", "content", 90);

  /* Let real photography arrive as a soft image reveal, never a fake illustration. */
  add("#solutions .solution-photo, .receptionist-workplace-photo", "photo", 65);

  if (!items.size) return;
  const io = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add("calvren-flow-visible");
      io.unobserve(entry.target);
    }
  }, {rootMargin: "0px 0px -7% 0px", threshold: 0.06});

  /* A restrained progress rule makes the page feel connected as sections pass. */
  const line = document.createElement("div");
  line.className = "calvren-reading-line";
  line.setAttribute("aria-hidden", "true");
  page.prepend(line);
  let scheduled = false;
  const updateLine = () => {
    scheduled = false;
    const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    const progress = Math.max(0, Math.min(1, window.scrollY / max));
    line.style.transform = "scaleX(" + progress.toFixed(4) + ")";
  };
  const scheduleLine = () => {
    if (scheduled) return;
    scheduled = true;
    window.requestAnimationFrame(updateLine);
  };

  page.classList.add("calvren-flow-enabled");
  for (const item of items) io.observe(item);
  window.addEventListener("scroll", scheduleLine, {passive: true});
  window.addEventListener("resize", scheduleLine, {passive: true});
  updateLine();

  const disable = () => {
    if (!motion.matches && !data.matches) return;
    io.disconnect();
    page.classList.remove("calvren-flow-enabled");
    line.remove();
    window.removeEventListener("scroll", scheduleLine);
    window.removeEventListener("resize", scheduleLine);
  };
  motion.addEventListener?.("change", disable);
  data.addEventListener?.("change", disable);
})();
