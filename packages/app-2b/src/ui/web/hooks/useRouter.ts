import { useCallback, useEffect, useState } from "react";

export interface UseRouterReturn {
  path: string;
  navigate: (path: string) => void;
}

export function useRouter(): UseRouterReturn {
  const [path, setPath] = useState(() => location.pathname);

  useEffect(() => {
    const handler = () => setPath(location.pathname);
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, []);

  const navigate = useCallback((newPath: string) => {
    if (location.pathname !== newPath) {
      history.pushState(null, "", newPath);
      setPath(newPath);
    }
  }, []);

  return { path, navigate };
}
