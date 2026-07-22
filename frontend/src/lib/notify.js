import { toast } from "sonner";

// Centralized, on-brand toast helper. Standard (title, description, options) signature so
// notifications stay consistent and actions are easy to attach.
//   notify.success("Deployed", "my-app is live")
//   notify.error("Deploy failed", err, { action: { label: "Retry", onClick: retry } })
const build = (fn) => (title, description, options = {}) =>
  fn(title, { description: description || undefined, ...options });

export const notify = {
  success: build(toast.success),
  info: build(toast.info),
  warn: build(toast.warning),
  warning: build(toast.warning),
  error: build(toast.error),
  message: build(toast),
  loading: (title, options = {}) => toast.loading(title, options),
  dismiss: (id) => toast.dismiss(id),
  promise: (p, msgs) => toast.promise(p, msgs),
};

export default notify;
