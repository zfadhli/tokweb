// Alpine store + htmx response glue. Every other behaviour is markup.

const TOAST_TTL = 4200;

document.addEventListener("alpine:init", () => {
  Alpine.store("toasts", {
    items: [],
    nextId: 1,
    push(detail) {
      const toast = {
        id: this.nextId++,
        level: detail?.level ?? "info",
        message: detail?.message ?? "",
      };
      if (!toast.message) return;
      this.items.push(toast);
      setTimeout(() => {
        this.items = this.items.filter((item) => item.id !== toast.id);
      }, TOAST_TTL);
    },
  });
});

document.body.addEventListener("toast", (event) => {
  Alpine.store("toasts").push(event.detail ?? {});
});

document.body.addEventListener("htmx:response:error", (event) => {
  const status = event.detail?.ctx?.response?.status;
  Alpine.store("toasts").push({
    level: "error",
    message: status ? `Request failed (${status})` : "Request failed",
  });
});

document.body.addEventListener("htmx:error", () => {
  Alpine.store("toasts").push({
    level: "error",
    message: "Network error. Is the server still running?",
  });
});
