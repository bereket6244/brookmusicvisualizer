// Renders gallery/manifest.json as cards. Plain JS, no build step, no
// dependencies — the gallery must stay isolated from the pipeline.

async function main() {
  const grid = document.getElementById("grid");
  const empty = document.getElementById("empty");
  let items = [];
  try {
    const res = await fetch("manifest.json");
    items = (await res.json()).items ?? [];
  } catch (err) {
    empty.hidden = false;
    empty.textContent = `could not load manifest.json: ${err}`;
    return;
  }
  if (items.length === 0) {
    empty.hidden = false;
    return;
  }
  for (const item of items) {
    const card = document.createElement("div");
    card.className = "card";
    let media = "";
    if (item.type === "video") {
      media = `<video src="${item.src}" controls loop muted></video>`;
    } else if (item.type === "image") {
      media = `<img src="${item.src}" alt="${item.title}" />`;
    }
    card.innerHTML = `
      ${media}
      <div class="body">
        ${item.tag ? `<span class="tag">${item.tag}</span>` : ""}
        <h2>${item.title ?? "untitled"}</h2>
        <div class="desc">${item.description ?? ""}</div>
      </div>`;
    grid.appendChild(card);
  }
}

main();
