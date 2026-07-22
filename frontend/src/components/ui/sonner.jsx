import { useTheme } from "next-themes";
import { Toaster as Sonner } from "sonner";
import { CheckCircle2, Info, TriangleAlert, CircleX, Loader2 } from "lucide-react";

const Toaster = ({ ...props }) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme}
      closeButton
      className="toaster group"
      icons={{
        success: <CheckCircle2 className="h-[18px] w-[18px]" strokeWidth={2} />,
        info: <Info className="h-[18px] w-[18px]" strokeWidth={2} />,
        warning: <TriangleAlert className="h-[18px] w-[18px]" strokeWidth={2} />,
        error: <CircleX className="h-[18px] w-[18px]" strokeWidth={2} />,
        loading: <Loader2 className="h-[18px] w-[18px] animate-spin" strokeWidth={2} />,
      }}
      toastOptions={{
        classNames: {
          toast: "ds-toast",
          title: "ds-toast-title",
          description: "ds-toast-desc",
          success: "ds-toast-success",
          info: "ds-toast-info",
          warning: "ds-toast-warning",
          error: "ds-toast-error",
          loading: "ds-toast-loading",
          actionButton: "ds-toast-action",
          cancelButton: "ds-toast-cancel",
          closeButton: "ds-toast-close",
        },
      }}
      {...props} />
  );
};

export { Toaster };
