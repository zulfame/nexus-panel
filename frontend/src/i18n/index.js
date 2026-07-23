import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

// Nexus Panel i18n. English is the default/source language. Indonesian (id) is provided
// for the app chrome; extend the `resources` maps below to cover more of the UI over time.
const resources = {
  en: {
    common: {
      nav: {
        overview: "Overview",
        projects: "Projects",
        databases: "Databases",
        terminal: "Terminal",
        activity: "Activity",
        settings: "Settings",
      },
      sidebar: { menu: "Menu", signout: "Sign out" },
      dashboard: {
        title: "Overview",
        subtitle: "Server resources & deployment overview",
      },
      settings: {
        tabs: {
          account: "Account",
          users: "Users",
          identity: "Identity",
          notifications: "Notifications",
          cloud: "Cloud Backup",
          system: "System",
        },
      },
      lang: { label: "Language", english: "English", indonesian: "Bahasa Indonesia" },
    },
  },
  id: {
    common: {
      nav: {
        overview: "Ringkasan",
        projects: "Proyek",
        databases: "Basis Data",
        terminal: "Terminal",
        activity: "Aktivitas",
        settings: "Pengaturan",
      },
      sidebar: { menu: "Menu", signout: "Keluar" },
      dashboard: {
        title: "Ringkasan",
        subtitle: "Sumber daya server & ringkasan deployment",
      },
      settings: {
        tabs: {
          account: "Akun",
          users: "Pengguna",
          identity: "Identitas",
          notifications: "Notifikasi",
          cloud: "Cadangan Cloud",
          system: "Sistem",
        },
      },
      lang: { label: "Bahasa", english: "English", indonesian: "Bahasa Indonesia" },
    },
  },
};

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: "en",
    supportedLngs: ["en", "id"],
    defaultNS: "common",
    ns: ["common"],
    interpolation: { escapeValue: false },
    detection: {
      order: ["localStorage"],
      lookupLocalStorage: "nexus-lang",
      caches: ["localStorage"],
    },
  });

export default i18n;
