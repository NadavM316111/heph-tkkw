import "./globals.css";
import InstallPrompt from "./components/InstallPrompt";

export const metadata = {
  title: "Sous",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Sous" },
};
export const viewport = { themeColor: "#0b1020", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <InstallPrompt />
      </body>
    </html>
  );
}
