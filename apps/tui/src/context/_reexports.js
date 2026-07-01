// Re-export the dialog and toast hooks from their canonical ports so callers
// can pull them from `./context` without caring about the implementation
// location.
export { useDialog } from "../components/dialog";
export { useToast } from "../components/toast";
