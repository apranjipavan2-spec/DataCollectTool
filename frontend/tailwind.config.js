/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Catalan palette
        catalan: {
          bg: "#11111b",
          surface: "#1e1e2e",
          hover: "#262637",
          border: "#2a2a3e",
          text: "#cdd6f4",
          textSecondary: "#a6adc8",
          textMuted: "#6c7086",
          primary: "#89b4fa",
          primaryDark: "#457dd1",
          primaryLight: "#b3d7ff",
          success: "#a6e3a1",
          warning: "#f9e2af",
          error: "#f38ba8",
          info: "#89b4fa",
        },
      },
      spacing: {
        xs: "4px",
        sm: "8px",
        md: "16px",
        lg: "24px",
        xl: "32px",
      },
      borderRadius: {
        sm: "4px",
        md: "8px",
        lg: "12px",
        xl: "16px",
      },
      fontSize: {
        xs: "11px",
        sm: "12px",
        base: "14px",
        lg: "16px",
        xl: "18px",
        "2xl": "24px",
        "3xl": "32px",
      },
      boxShadow: {
        sm: "0 1px 2px rgba(0,0,0,0.1)",
        md: "0 4px 12px rgba(0,0,0,0.15)",
        lg: "0 8px 24px rgba(0,0,0,0.2)",
      },
    },
  },
  plugins: [],
}
