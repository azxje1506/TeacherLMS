/* Blocking inline script: applies the persisted appearance to <html> before the
 * first paint so there is no theme flash on load. Mirrors SettingsProvider. */

const script = `(function(){try{var g=function(k,d){try{return localStorage.getItem(k)||d}catch(e){return d}};
var el=document.documentElement;
el.dataset.theme=g('etlms.theme','light');
el.dataset.accent=g('etlms.accent','crimson');
el.dataset.surface=g('etlms.surface','soft');
el.dataset.spacing=g('etlms.spacing','cozy');
}catch(e){}})();`;

export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: script }} suppressHydrationWarning />;
}
