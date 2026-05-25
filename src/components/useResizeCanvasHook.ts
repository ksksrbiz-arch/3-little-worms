import { useEffect, useState } from 'react';

export interface WindowDimensions {
  width: number;
  height: number;
}

const useResizeCanvasHook = (
  canvasRef: React.RefObject<HTMLCanvasElement | null> | React.RefObject<HTMLCanvasElement>,
  uiScaleFactor: number
): WindowDimensions => {
  const [windowDimensions, setWindowDimensions] = useState<WindowDimensions>({
    width: typeof window !== 'undefined' ? window.innerWidth : 1000,
    height: typeof window !== 'undefined' ? window.innerHeight : 563,
  });

  const updateDimensions = () => {
    setWindowDimensions((prev) => {
      // Prevent state updates if dimensions have not actually changed
      if (prev.width === window.innerWidth && prev.height === window.innerHeight) {
        return prev;
      }
      return {
        width: window.innerWidth,
        height: window.innerHeight,
      };
    });
  };

  useEffect(() => {
    window.addEventListener('resize', updateDimensions);

    return () => {
      window.removeEventListener('resize', updateDimensions);
    };
  }, []);

  useEffect(() => {
    if (!canvasRef.current) return;

    const canvas = canvasRef.current;
    const { width, height } = windowDimensions;

    // Define your desired canvas aspect ratio (e.g., 16:9)
    const aspectRatio = 16 / 9;

    // Calculate the scaled width and height based on the window dimensions and aspect ratio
    let scaledWidth = width;
    let scaledHeight = height;

    if (width / height > aspectRatio) {
      // Window is wider than the aspect ratio
      scaledWidth = height * aspectRatio;
    } else {
      // Window is taller than the aspect ratio
      scaledHeight = width / aspectRatio;
    }

    // Set the canvas dimensions
    canvas.width = scaledWidth;
    canvas.height = scaledHeight;

    // Apply UI scaling based on the canvas dimensions and the uiScaleFactor
    const scaleX = scaledWidth / (1000 * uiScaleFactor); // 1000 is the original width
    const scaleY = scaledHeight / (563 * uiScaleFactor); // 563 is the original height

    // You can use this scale value to adjust your UI elements.
    // For example, you can apply a CSS transform: scale() to your UI container
    // const scale = Math.min(scaleX, scaleY);
  }, [windowDimensions, canvasRef, uiScaleFactor]);

  return windowDimensions;
};

export default useResizeCanvasHook;
