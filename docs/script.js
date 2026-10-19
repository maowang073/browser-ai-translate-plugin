const menuButton = document.querySelector(".menu-button");
const siteNav = document.querySelector(".site-nav");
const toast = document.querySelector("#toast");
const copyButton = document.querySelector("#copyAddress");

function setMenu(open) {
  menuButton.setAttribute("aria-expanded", String(open));
  siteNav.classList.toggle("open", open);
  document.body.classList.toggle("menu-open", open);
  menuButton.querySelector(".sr-only").textContent = open ? "关闭导航" : "打开导航";
}

menuButton.addEventListener("click", () => {
  setMenu(menuButton.getAttribute("aria-expanded") !== "true");
});

siteNav.addEventListener("click", (event) => {
  if (event.target.closest("a")) setMenu(false);
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") setMenu(false);
});

window.addEventListener("resize", () => {
  if (window.innerWidth > 760) setMenu(false);
});

let toastTimer;
function showToast(message) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add("show");
  toastTimer = setTimeout(() => toast.classList.remove("show"), 1800);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.append(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }
}

copyButton.addEventListener("click", async () => {
  await copyText(copyButton.dataset.address);
  const original = copyButton.textContent;
  copyButton.textContent = "已复制";
  showToast("地址已复制，请粘贴到 Chrome 地址栏");
  setTimeout(() => {
    copyButton.textContent = original;
  }, 1600);
});

const revealTargets = [
  ...document.querySelectorAll(".section-intro, .feature, .open-copy, .config-window, .install-steps > li")
];

if ("IntersectionObserver" in window && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
  revealTargets.forEach((element) => element.setAttribute("data-reveal", ""));
  const revealObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add("revealed");
      observer.unobserve(entry.target);
    });
  }, { rootMargin: "0px 0px -9%", threshold: 0.08 });
  requestAnimationFrame(() => revealTargets.forEach((element) => revealObserver.observe(element)));
}
