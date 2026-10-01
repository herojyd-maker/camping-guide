(function () {
  "use strict";

  var PAGE_SIZE = 30;
  var FEATURES = ["오토캠핑", "글램핑", "카라반", "차박", "반려동물", "수영장", "계곡", "바닷가", "예약 가능"];
  // 시·도를 부르는 다른 이름 → 지역 필터 이름
  var REGION_ALIAS = {
    "서울시": "서울", "서울특별시": "서울", "인천시": "인천", "경기도": "경기", "강원도": "강원",
    "충청북도": "충북", "충청남도": "충남", "대전시": "대전", "세종시": "세종",
    "전라북도": "전북", "전남": "전남광주", "전라남도": "전남광주", "광주": "전남광주", "광주광역시": "전남광주",
    "경상북도": "경북", "대구시": "대구", "경상남도": "경남", "부산시": "부산", "울산시": "울산", "제주도": "제주"
  };

  var sites = window.CAMPSITES || [];
  var byId = {};
  sites.forEach(function (s) { byId[s.id] = s; });

  var state = {
    query: "",        // 이름·주소 글자 검색
    region: "전체",
    features: {},
    sort: "reviews",
    center: null,     // { lat, lng, label } 기준 위치 (지역 주변 찾기, 내 위치)
    shown: PAGE_SIZE
  };
  var map = null;
  var markerLayer = null;
  var centerMarker = null;

  var $form = document.getElementById("search-form");
  var $search = document.getElementById("search");
  var $nearby = document.getElementById("nearby");
  var $notice = document.getElementById("notice");
  var $regions = document.getElementById("regions");
  var $features = document.getElementById("features");
  var $count = document.getElementById("count");
  var $sort = document.getElementById("sort");
  var $list = document.getElementById("list");
  var $more = document.getElementById("more");
  var $detail = document.getElementById("detail");
  var $detailBody = document.getElementById("detail-body");
  var $fallback = document.getElementById("map-fallback");

  // 데이터는 외부에서 수집한 값이므로 화면에 넣기 전에 항상 이스케이프한다.
  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  function num(n) {
    return Number(n).toLocaleString("ko-KR");
  }

  function naverMapUrl(site) {
    return "https://map.naver.com/p/entry/place/" + encodeURIComponent(site.id);
  }

  // 네이버 이미지 서버의 썸네일 주소. type은 서버가 허용하는 크기만 쓸 수 있다.
  // 확인된 값: f640_640, f320_240(잘라내기), w750_sharpen, w560_sharpen(가로 맞춤)
  function thumb(url, type) {
    return "https://search.pstatic.net/common/?autoRotate=true&type=" + type + "&src=" + encodeURIComponent(url);
  }

  // 두 좌표 사이의 직선 거리(km)
  function distanceKm(a, b) {
    var rad = Math.PI / 180;
    var dLat = (b.lat - a.lat) * rad;
    var dLng = (b.lng - a.lng) * rad;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  }

  function distanceText(site) {
    if (!state.center) return "";
    var km = distanceKm(state.center, site);
    return km < 10 ? km.toFixed(1) + "km" : Math.round(km) + "km";
  }

  function hasFeature(site, feature) {
    if (feature === "예약 가능") return !!site.booking;
    return (site.facilities || []).indexOf(feature) !== -1;
  }

  function filtered() {
    var q = state.query.trim().toLowerCase();
    var features = Object.keys(state.features);

    var items = sites.filter(function (s) {
      if (state.region !== "전체" && s.region !== state.region) return false;
      if (q && (s.name + " " + s.address).toLowerCase().indexOf(q) === -1) return false;
      return features.every(function (f) { return hasFeature(s, f); });
    });

    // 값이 없는 곳은 뒤로 보낸다.
    var sorters = {
      reviews: function (a, b) { return (b.reviews || 0) - (a.reviews || 0); },
      rating: function (a, b) { return (b.rating || 0) - (a.rating || 0) || (b.reviews || 0) - (a.reviews || 0); },
      price: function (a, b) { return (a.price || Infinity) - (b.price || Infinity); },
      distance: function (a, b) { return distanceKm(state.center, a) - distanceKm(state.center, b); }
    };
    return items.sort(sorters[state.sort]);
  }

  // ----- 화면 그리기 -----

  function chipsHtml(names, isActive, attr) {
    return names.map(function (name) {
      return '<button type="button" class="chip' + (isActive(name) ? " active" : "") + '" data-' + attr + '="' + esc(name) + '">' + esc(name) + "</button>";
    }).join("");
  }

  function renderFilters() {
    var regions = ["전체"].concat(window.CAMPSITE_REGIONS || []);
    $regions.innerHTML = chipsHtml(regions, function (r) { return r === state.region; }, "region");
    $features.innerHTML = chipsHtml(FEATURES, function (f) { return !!state.features[f]; }, "feature");
  }

  function reviewsText(site) {
    var parts = [];
    if (site.reviews) parts.push("방문자 리뷰 " + num(site.reviews));
    if (site.blog) parts.push("블로그 리뷰 " + num(site.blog));
    return parts.join(" · ");
  }

  // 유형을 맨 앞에 둔 시설·특징 목록
  function featureList(site) {
    return [site.type].concat((site.facilities || []).filter(function (f) { return f !== site.type; }));
  }

  function cardHtml(s) {
    var dist = distanceText(s);
    var reviews = reviewsText(s);
    return '<li class="card" tabindex="0" data-id="' + esc(s.id) + '">' +
      '<div class="photo">' +
        '<span class="no-photo">사진 없음</span>' +
        (s.image ? '<img src="' + esc(thumb(s.image, "f640_640")) + '" alt="" loading="lazy">' : "") +
        (s.booking ? '<span class="badge">네이버 예약</span>' : "") +
      "</div>" +
      '<div class="meta">' +
        '<div class="meta-top">' +
          "<h2>" + esc(s.name) + "</h2>" +
          (s.rating ? '<span class="rating">★ ' + s.rating.toFixed(2) + "</span>" : "") +
        "</div>" +
        '<p class="sub addr">' + (dist ? dist + " · " : "") + esc(s.address) + "</p>" +
        (reviews ? '<p class="sub">' + reviews + "</p>" : "") +
        '<p class="sub">' + esc(featureList(s).slice(0, 4).join(" · ")) + "</p>" +
        (s.price ? '<p class="price"><strong>' + num(s.price) + "원</strong>부터 / 1박</p>" : "") +
      "</div>" +
      "</li>";
  }

  function render() {
    var items = filtered();
    var label = "캠핑장 " + num(items.length) + "곳";
    if (state.center) label = "‘" + state.center.label + "’ 주변 · " + label;
    $count.textContent = label;

    if (!items.length) {
      $list.innerHTML = '<li class="empty">조건에 맞는 캠핑장이 없습니다.</li>';
    } else {
      $list.innerHTML = items.slice(0, state.shown).map(cardHtml).join("");
    }
    $more.hidden = items.length <= state.shown;
    $more.textContent = "더 보기 (" + num(Math.min(state.shown, items.length)) + " / " + num(items.length) + ")";

    updateMarkers(items);
  }

  // 조건이 바뀌면 목록을 처음부터 다시 보여 준다.
  function refresh() {
    state.shown = PAGE_SIZE;
    renderFilters();
    render();
  }

  function notice(message) {
    $notice.textContent = message || "";
    $notice.hidden = !message;
  }

  function openDetail(id) {
    var site = byId[id];
    if (!site) return;

    var rows = [
      ["주소", esc(site.address)],
      ["전화", site.tel ? '<a href="tel:' + esc(site.tel) + '">' + esc(site.tel) + "</a>" : ""],
      ["가격", site.price ? "1박 " + num(site.price) + "원부터 (" + esc(window.CAMPSITES_DATE) + " 기준)" : ""],
      ["예약", site.booking ? "네이버 예약 가능" : ""],
      ["거리", state.center ? "‘" + esc(state.center.label) + "’에서 직선거리 약 " + distanceText(site) : ""]
    ].filter(function (row) { return row[1]; })
      .map(function (row) { return "<dt>" + row[0] + "</dt><dd>" + row[1] + "</dd>"; })
      .join("");

    var reviews = reviewsText(site);
    var amenities = featureList(site).map(function (f) { return "<li>" + esc(f) + "</li>"; }).join("");

    $detailBody.innerHTML =
      (site.image ? '<img class="detail-img" src="' + esc(thumb(site.image, "w750_sharpen")) + '" alt="">' : "") +
      '<div class="detail-content' + (site.image ? "" : " no-img") + '">' +
        "<h2>" + esc(site.name) + "</h2>" +
        (site.rating
          ? '<div class="rating-card"><div class="rating-display">' + site.rating.toFixed(2) + "</div>" +
            "<p>" + (reviews || "네이버 별점") + "</p></div>"
          : (reviews ? '<p class="sub">' + reviews + "</p>" : "")) +
        (site.description ? '<p class="quote">“' + esc(site.description) + "”</p>" : "") +
        "<dl>" + rows + "</dl>" +
        "<h3>시설 및 특징</h3>" +
        '<ul class="amenities">' + amenities + "</ul>" +
        '<a class="btn-primary" href="' + naverMapUrl(site) + '" target="_blank" rel="noopener">네이버 지도에서 사진·리뷰·예약 보기</a>' +
      "</div>";

    if (!$detail.open) $detail.showModal();
    $detail.scrollTop = 0;
    if (map) map.setView([site.lat, site.lng], Math.max(map.getZoom(), 12));
  }

  // ----- 지도 (Leaflet + OpenStreetMap, API 키 불필요) -----

  function updateMarkers(items) {
    if (!map) return;
    markerLayer.clearLayers();
    var points = [];
    // 점이 많을 때는 작게 그려 지도가 가려지지 않게 한다.
    var radius = items.length > 800 ? 3 : items.length > 200 ? 4.5 : 6;
    items.forEach(function (s) {
      points.push([s.lat, s.lng]);
      L.circleMarker([s.lat, s.lng], {
        radius: radius, color: "#fff", weight: 1, fillColor: "#222222", fillOpacity: .9
      }).bindTooltip(s.name).on("click", function () { openDetail(s.id); }).addTo(markerLayer);
    });

    if (centerMarker) { centerMarker.remove(); centerMarker = null; }
    if (state.center) {
      centerMarker = L.circleMarker([state.center.lat, state.center.lng], {
        radius: 9, color: "#fff", weight: 2, fillColor: "#ff385c", fillOpacity: 1
      }).bindTooltip(state.center.label).addTo(map);
      map.setView([state.center.lat, state.center.lng], 10);
    } else if (points.length) {
      map.fitBounds(points, { padding: [30, 30], maxZoom: 12 });
    }
  }

  function initMap() {
    if (!window.L) {
      $fallback.hidden = false;
      return;
    }
    map = L.map("map", { preferCanvas: true }).setView([36.3, 127.8], 7);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);
    markerLayer = L.layerGroup().addTo(map);
  }

  // ----- 기준 위치 정하기 -----

  function setCenter(center) {
    state.center = center;
    state.query = "";
    state.region = "전체";
    state.sort = "distance";
    $sort.querySelector('[value="distance"]').disabled = false;
    $sort.value = "distance";
    notice("");
    refresh();
  }

  function clearCenter() {
    if (!state.center) return;
    state.center = null;
    if (state.sort === "distance") state.sort = "reviews";
    $sort.querySelector('[value="distance"]').disabled = true;
    $sort.value = state.sort;
  }

  // 주소의 시·군·구·읍·면 이름이 입력값으로 시작하는 캠핑장들 (예: "수원" → "경기 수원시 …")
  function sitesInArea(q) {
    return sites.filter(function (s) {
      return s.address.split(" ").slice(1, 4).some(function (token) { return token.indexOf(q) === 0; });
    });
  }

  function findAround(text) {
    var q = text.trim();
    if (!q) {
      clearCenter();
      state.query = "";
      notice("");
      return refresh();
    }

    // 1) 시·도 이름이면 지역 필터로 처리
    var region = REGION_ALIAS[q] || ((window.CAMPSITE_REGIONS || []).indexOf(q) !== -1 ? q : "");
    if (region) {
      clearCenter();
      state.query = "";
      state.region = region;
      $search.value = "";
      notice("");
      return refresh();
    }

    // 2) 시·군·구 이름이면 그 지역 캠핑장들의 중심을 기준 위치로 사용
    var area = q.length >= 2 ? sitesInArea(q) : [];
    if (area.length) {
      var lat = 0, lng = 0;
      area.forEach(function (s) { lat += s.lat; lng += s.lng; });
      return setCenter({ lat: lat / area.length, lng: lng / area.length, label: q });
    }

    // 3) 캠핑장 이름과 맞으면 글자 검색 결과를 그대로 보여 준다
    var lower = q.toLowerCase();
    if (sites.some(function (s) { return s.name.toLowerCase().indexOf(lower) !== -1; })) {
      clearCenter();
      state.query = q;
      notice("");
      return refresh();
    }

    // 4) 그 밖의 지명(동네, 관광지 등)은 OpenStreetMap 지명 검색으로 좌표를 찾는다
    // 응답을 기다리는 사이 입력이 바뀌었으면 결과를 버린다.
    function stale() { return $search.value.trim() !== q; }

    notice("‘" + q + "’ 위치를 찾는 중…");
    fetch("https://nominatim.openstreetmap.org/search?format=json&countrycodes=kr&accept-language=ko&limit=1&q=" + encodeURIComponent(q))
      .then(function (res) { return res.json(); })
      .then(function (results) {
        if (stale()) return;
        if (!results.length) return notice("‘" + q + "’ 위치를 찾지 못했습니다. 시·군·구 이름으로 다시 입력해 보세요.");
        setCenter({ lat: Number(results[0].lat), lng: Number(results[0].lon), label: q });
        // 같은 이름의 다른 곳일 수 있으므로 어느 위치로 찾았는지 알려 준다.
        notice("기준 위치: " + results[0].display_name);
      })
      .catch(function () {
        if (stale()) return;
        notice("위치 검색에 실패했습니다. 인터넷 연결을 확인하거나 시·군·구 이름으로 입력해 보세요.");
      });
  }

  function findFromMyLocation() {
    if (!navigator.geolocation) {
      return notice("이 브라우저에서는 위치 정보를 사용할 수 없습니다. 지역 이름을 입력해 주세요.");
    }
    $nearby.disabled = true;
    $nearby.textContent = "위치 확인 중…";

    function done() {
      $nearby.disabled = false;
      $nearby.textContent = "내 위치에서 찾기";
    }

    navigator.geolocation.getCurrentPosition(function (pos) {
      done();
      $search.value = "";
      setCenter({ lat: pos.coords.latitude, lng: pos.coords.longitude, label: "내 위치" });
    }, function () {
      done();
      notice("내 위치를 가져오지 못했습니다. 위치 권한을 허용하거나, 위 입력란에 지역 이름(예: 수원)을 넣고 ‘주변 찾기’를 눌러 주세요.");
    }, { timeout: 10000 });
  }

  // ----- 이벤트 -----

  $form.addEventListener("submit", function (e) {
    e.preventDefault();
    findAround($search.value);
  });

  // 입력하는 동안에는 이름·주소 글자 검색으로 바로 걸러 준다.
  $search.addEventListener("input", function () {
    clearCenter();
    state.query = $search.value;
    notice("");
    refresh();
  });

  $nearby.addEventListener("click", findFromMyLocation);

  $regions.addEventListener("click", function (e) {
    var chip = e.target.closest(".chip");
    if (!chip) return;
    state.region = chip.dataset.region;
    refresh();
  });

  $features.addEventListener("click", function (e) {
    var chip = e.target.closest(".chip");
    if (!chip) return;
    var f = chip.dataset.feature;
    if (state.features[f]) delete state.features[f];
    else state.features[f] = true;
    refresh();
  });

  $sort.addEventListener("change", function () {
    state.sort = $sort.value;
    refresh();
  });

  $more.addEventListener("click", function () {
    state.shown += PAGE_SIZE;
    render();
  });

  $list.addEventListener("click", function (e) {
    var card = e.target.closest(".card");
    if (card) openDetail(card.dataset.id);
  });

  $list.addEventListener("keydown", function (e) {
    if (e.key !== "Enter") return;
    var card = e.target.closest(".card");
    if (card) openDetail(card.dataset.id);
  });

  // 사진을 불러오지 못하면 빈 썸네일로 둔다.
  document.addEventListener("error", function (e) {
    if (e.target.tagName === "IMG") e.target.remove();
  }, true);

  document.getElementById("detail-close").addEventListener("click", function () {
    $detail.close();
  });

  $detail.addEventListener("click", function (e) {
    if (e.target === $detail) $detail.close();
  });

  document.getElementById("data-note").textContent =
    "장소 정보·사진 출처: 네이버 지도 검색 결과 (" + (window.CAMPSITES_DATE || "") + " 수집). " +
    "가격·예약·운영 여부는 바뀔 수 있으니 방문 전 네이버 지도에서 확인해 주세요. 별점은 네이버가 제공하는 곳만 표시됩니다.";

  initMap();
  refresh();
})();
