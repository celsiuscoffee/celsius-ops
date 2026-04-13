"use client";

import { useEffect } from "react";

export default function Home() {
  useEffect(() => {
    // In Capacitor, the server.url config loads the remote site directly.
    // This page only shows briefly as a splash fallback.
  }, []);

  return (
    <div
      style={{
        backgroundColor: "#160800",
        color: "#fff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "100vh",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <p>Loading...</p>
    </div>
  );
}
