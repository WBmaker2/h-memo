import { useEffect, useState } from "react";
import { LandingPage } from "./landing/LandingPage";
import { WebApp } from "./WebApp";

function isWebAppHash(hash: string): boolean {
  return hash === "#/app" || hash === "#app";
}

export function AppRouter() {
  const [isWebAppRoute, setIsWebAppRoute] = useState<boolean>(() => isWebAppHash(window.location.hash));

  useEffect(() => {
    const handleHashChange = () => {
      setIsWebAppRoute(isWebAppHash(window.location.hash));
    };

    window.addEventListener("hashchange", handleHashChange);
    return () => {
      window.removeEventListener("hashchange", handleHashChange);
    };
  }, []);

  return isWebAppRoute ? <WebApp /> : <LandingPage />;
}
