window.showPageLoader = function (text = "Loading...") {
  const loader = document.getElementById("pageLoader");
  const loaderText = document.getElementById("pageLoaderText");
  if (!loader) return;
  if (loaderText) loaderText.textContent = text;
  loader.classList.add("show");
};

window.hidePageLoader = function () {
  const loader = document.getElementById("pageLoader");
  if (!loader) return;
  loader.classList.remove("show");
};