import { useEffect, useState } from "react";
import { LandingPage } from "./landing/LandingPage";
import { WebApp } from "./WebApp";

function isWebAppHash(hash: string): boolean {
  return hash === "#/app" || hash === "#app";
}

function shouldOpenWebAppByDefault(): boolean {
  return import.meta.env.VITE_H_MEMO_WEB_DEFAULT_ROUTE === "app";
}

export function AppRouter() {
  const [isWebAppRoute, setIsWebAppRoute] = useState<boolean>(
    () => shouldOpenWebAppByDefault() || isWebAppHash(window.location.hash)
  );

  useEffect(() => {
    const handleHashChange = () => {
      setIsWebAppRoute(shouldOpenWebAppByDefault() || isWebAppHash(window.location.hash));
    };

    window.addEventListener("hashchange", handleHashChange);
    return () => {
      window.removeEventListener("hashchange", handleHashChange);
    };
  }, []);

  return isWebAppRoute ? <WebApp /> : <LandingPage />;
}
