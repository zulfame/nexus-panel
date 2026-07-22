import { useTheme } from "next-themes"
import { Toaster as Sonner, toast } from "sonner"

const Toaster = ({
  ...props
}) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme}
      richColors
      closeButton
      className="toaster group"
      toastOptions={{
        classNames: {
          toast: "group toast group-[.toaster]:shadow-lg group-[.toaster]:rounded-[var(--ds-radius-card,0.75rem)] group-[.toaster]:border",
          description: "group-[.toast]:opacity-90",
          actionButton:
            "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton:
            "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props} />
  );
}

export { Toaster, toast }
