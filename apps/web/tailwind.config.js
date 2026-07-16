/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0b0d0f",
        panel: "#121619",
        line: "#252b2f",
        mist: "#9da8a1",
        acid: "#b8f36b",
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["Manrope", "Inter", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(184,243,107,.15), 0 22px 70px rgba(0,0,0,.32)",
      },
    },
  },
  plugins: [],
};
