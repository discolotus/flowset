/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0c0f0d",
        panel: "#141915",
        line: "#29302d",
        mist: "#9aa59e",
        acid: "#b8de80",
      },
      fontFamily: {
        sans: ["Avenir Next", "Avenir", "SF Pro Text", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["Avenir Next", "Avenir", "SF Pro Display", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(184,243,107,.15), 0 22px 70px rgba(0,0,0,.32)",
      },
    },
  },
  plugins: [],
};
