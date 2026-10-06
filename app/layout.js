export const metadata = { title: "Orbix AI Backend" };

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", background: "#0c0c0e", color: "#eceef0", padding: 24 }}>
        {children}
      </body>
    </html>
  );
}
