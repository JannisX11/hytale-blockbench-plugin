/// <reference types="blockbench-types" />


import * as en from "./translations/en.json";
import * as pt from "./translations/pt-BR.json";

type TranslationSchema = typeof en;


const translations: Record<string, any> = {
  en,
  pt,
};

export function t(path: string): string {
   const langCode = Language.code.split("_")[0];

    const currentLangObj = translations[langCode] || translations["en"];
  const resolvePath = (obj: any, path: string) => {
    return path.split(".").reduce((prev, curr) => {
      return prev ? prev[curr] : null;
    }, obj);
  };

   let result = resolvePath(currentLangObj, path);
  if (!result && langCode !== "en") {
    result = resolvePath(translations["en"], path);
  }

    return result || path;
}
