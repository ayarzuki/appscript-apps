/**
 * Code.gs — Main entry point for SIS Sparks Math Web App.
 */

function doGet(e) {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle(APP_TITLE || 'Sistem Administrasi Akademik Sparks Math')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function include(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

/**
 * Client-callable function to retrieve application title and version.
 * @return {{title: string, version: string}}
 */
function getAppVersionInfo() {
  return {
    title: APP_TITLE,
    version: APP_VERSION
  };
}
