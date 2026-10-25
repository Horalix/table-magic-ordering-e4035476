import { useTheme } from "next-themes";
import { Toaster as Sonner, toast } from "sonner";
import { useT } from "@/lib/i18n";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();
  const t = useT();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      containerAriaLabel={t("notifications")}
      // Top of the screen: at the bottom, "Added to order" sat exactly on top
      // of the cart bar and the Send button it was confirming.
      position="top-center"
      offset="calc(env(safe-area-inset-top) + 12px)"
      duration={1800}
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-foreground group-[.toaster]:text-background group-[.toaster]:border-0 group-[.toaster]:shadow-xl group-[.toaster]:rounded-2xl group-[.toaster]:py-3",
          title: "group-[.toast]:font-semibold",
          description: "group-[.toast]:text-background/70",
          actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  );
};

export { Toaster, toast };
