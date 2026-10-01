(function () {
  "use strict";

  var STEP_MS = 4500;   // 자동 재생 시 한 단계에 머무는 시간
  var INK = 0x222222;
  var PRIMARY = 0xff385c;

  var STEPS = [
    {
      title: "요청",
      tool: "사용자 → Claude Code",
      text: "“국내 캠핑장을 안내하는 홈페이지를 만들어 줘”라고 요청합니다."
    },
    {
      title: "수집",
      tool: "Playwright MCP",
      text: "브라우저로 네이버 지도를 열어 110여 개 지역의 “○○ 캠핑장” 검색 결과를 읽어 옵니다."
    },
    {
      title: "정리",
      tool: "data/campsites.js",
      text: "중복을 없애고 캠핑 업종만 골라 시·도별로 분류해 약 3,300곳을 파일 하나로 저장합니다."
    },
    {
      title: "디자인",
      tool: "npx getdesign add airbnb",
      text: "DESIGN.md를 설치하고 색, 글꼴 크기, 모서리 규칙을 그대로 따릅니다."
    },
    {
      title: "제작",
      tool: "HTML · CSS · JS · Leaflet",
      text: "검색, 조건 필터, 정렬, 지도를 정적 파일만으로 만듭니다. LLM이나 MCP 없이 동작합니다."
    },
    {
      title: "확인",
      tool: "Playwright MCP",
      text: "완성된 페이지를 다시 열어 검색, 필터, 상세 팝업, 모바일 화면을 테스트합니다."
    }
  ];

  var $stage = document.getElementById("stage");
  var $steps = document.getElementById("steps");
  var $toggle = document.getElementById("toggle");
  var $fallback = document.getElementById("stage-fallback");

  var reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var active = 0;
  var playing = !reducedMotion;
  var lastSwitch = performance.now();

  // ----- 단계 설명 목록 -----

  $steps.innerHTML = STEPS.map(function (s, i) {
    return '<li><button type="button" class="step" data-step="' + i + '">' +
      '<span class="step-num">' + (i + 1) + "</span>" +
      '<span class="step-body">' +
        '<strong class="step-title">' + s.title + "</strong>" +
        '<span class="step-tool">' + s.tool + "</span>" +
        '<span class="step-text">' + s.text + "</span>" +
      "</span>" +
      "</button></li>";
  }).join("");

  var stepButtons = Array.prototype.slice.call($steps.querySelectorAll(".step"));
  var labels = [];

  function setActive(index) {
    active = index;
    lastSwitch = performance.now();
    stepButtons.forEach(function (btn, i) {
      btn.classList.toggle("active", i === active);
      btn.setAttribute("aria-current", i === active ? "step" : "false");
    });
    labels.forEach(function (el, i) { el.classList.toggle("active", i === active); });
  }

  function setPlaying(value) {
    playing = value;
    lastSwitch = performance.now();
    $toggle.textContent = playing ? "일시정지" : "재생";
  }

  $steps.addEventListener("click", function (e) {
    var btn = e.target.closest(".step");
    if (!btn) return;
    setPlaying(false);
    setActive(Number(btn.dataset.step));
  });

  $toggle.addEventListener("click", function () { setPlaying(!playing); });

  setActive(0);
  setPlaying(playing);

  // ----- 3D 장면 -----

  function createRenderer() {
    try {
      return new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch (err) {
      return null;
    }
  }

  var renderer = window.THREE ? createRenderer() : null;
  if (!renderer) {
    $fallback.hidden = false;
    $toggle.hidden = true;
    return;
  }

  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  $stage.appendChild(renderer.domElement);

  var scene = new THREE.Scene();
  var camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);

  scene.add(new THREE.HemisphereLight(0xffffff, 0xdddddd, 1.6));
  var sun = new THREE.DirectionalLight(0xffffff, 1.8);
  sun.position.set(4, 8, 6);
  scene.add(sun);

  // 단계가 놓이는 완만한 S자 경로
  var points = STEPS.map(function (_, i) {
    return new THREE.Vector3((i - (STEPS.length - 1) / 2) * 3.2, 0, Math.sin(i * 1.15) * 1.7);
  });
  var curve = new THREE.CatmullRomCurve3(points);

  scene.add(new THREE.Mesh(
    new THREE.TubeGeometry(curve, 240, 0.035, 8, false),
    new THREE.MeshStandardMaterial({ color: 0xc1c1c1, roughness: 1 })
  ));

  var white = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .6 });

  function mesh(geometry, material, x, y, z) {
    var m = new THREE.Mesh(geometry, material);
    m.position.set(x || 0, y || 0, z || 0);
    return m;
  }

  // 단계별 도형. mat은 강조 색이 바뀌는 재질, white는 세부 장식용.
  var builders = [
    // 요청: 말풍선
    function (mat) {
      var g = new THREE.Group();
      var bubble = mesh(new THREE.SphereGeometry(.55, 32, 24), mat, 0, .1, 0);
      bubble.scale.set(1.15, .85, .8);
      var tail = mesh(new THREE.ConeGeometry(.16, .34, 16), mat, -.28, -.42, 0);
      tail.rotation.z = Math.PI + .5;
      g.add(bubble, tail);
      [-.25, 0, .25].forEach(function (x) { g.add(mesh(new THREE.SphereGeometry(.07, 12, 12), white, x, .1, .42)); });
      return g;
    },
    // 수집: 지도와 위치 핀
    function (mat) {
      var g = new THREE.Group();
      var map = mesh(new THREE.BoxGeometry(1.25, .06, .9), white, 0, -.35, 0);
      map.rotation.x = .25;
      var head = mesh(new THREE.SphereGeometry(.24, 24, 20), mat, 0, .4, 0);
      var tip = mesh(new THREE.ConeGeometry(.19, .5, 20), mat, 0, .02, 0);
      tip.rotation.x = Math.PI;
      g.add(map, head, tip, mesh(new THREE.SphereGeometry(.09, 12, 12), white, 0, .4, .2));
      return g;
    },
    // 정리: 데이터 저장소
    function (mat) {
      var g = new THREE.Group();
      [-.3, 0, .3].forEach(function (y) { g.add(mesh(new THREE.CylinderGeometry(.5, .5, .22, 40), mat, 0, y, 0)); });
      [-.15, .15].forEach(function (y) { g.add(mesh(new THREE.CylinderGeometry(.44, .44, .08, 40), white, 0, y, 0)); });
      return g;
    },
    // 디자인: 문서
    function (mat) {
      var g = new THREE.Group();
      g.add(mesh(new THREE.BoxGeometry(.85, 1.1, .08), mat));
      [.3, .1, -.1, -.3].forEach(function (y, i) {
        g.add(mesh(new THREE.BoxGeometry(i === 3 ? .35 : .6, .07, .02), white, i === 3 ? -.125 : 0, y, .05));
      });
      return g;
    },
    // 제작: 브라우저 창
    function (mat) {
      var g = new THREE.Group();
      g.add(mesh(new THREE.BoxGeometry(1.3, .9, .08), mat));
      g.add(mesh(new THREE.BoxGeometry(1.14, .56, .02), white, 0, -.09, .05));
      [-.48, -.36, -.24].forEach(function (x) { g.add(mesh(new THREE.SphereGeometry(.04, 12, 12), white, x, .33, .05)); });
      return g;
    },
    // 확인: 체크 표시
    function (mat) {
      var g = new THREE.Group();
      g.add(mesh(new THREE.TorusGeometry(.55, .09, 16, 48), mat));
      var shortBar = mesh(new THREE.BoxGeometry(.28, .1, .1), mat, -.17, -.08, 0);
      shortBar.rotation.z = -Math.PI / 4;
      var longBar = mesh(new THREE.BoxGeometry(.52, .1, .1), mat, .1, .02, 0);
      longBar.rotation.z = Math.PI / 4;
      g.add(shortBar, longBar);
      return g;
    }
  ];

  var platformGeometry = new THREE.CylinderGeometry(1, 1, .1, 48);
  var platformMaterial = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 1 });

  var nodes = STEPS.map(function (step, i) {
    var material = new THREE.MeshStandardMaterial({ color: INK, roughness: .45 });
    var model = builders[i](material);
    model.position.y = 1.15;

    var group = new THREE.Group();
    group.position.copy(points[i]);
    group.add(mesh(platformGeometry, platformMaterial, 0, -.05, 0), model);
    group.traverse(function (obj) { obj.userData.step = i; });
    scene.add(group);

    var label = document.createElement("div");
    label.className = "node-label";
    label.textContent = (i + 1) + " " + step.title;
    $stage.appendChild(label);
    labels.push(label);

    return { group: group, model: model, material: material, glow: 0 };
  });
  labels[active].classList.add("active");

  // 경로를 따라 흐르는 작은 입자들과, 현재 단계로 이동하는 큰 입자
  var flowMaterial = new THREE.MeshBasicMaterial({ color: PRIMARY, transparent: true, opacity: .55 });
  var flowGeometry = new THREE.SphereGeometry(.06, 10, 10);
  var flow = [];
  for (var f = 0; f < 36; f++) {
    var dot = new THREE.Mesh(flowGeometry, flowMaterial);
    scene.add(dot);
    flow.push({ mesh: dot, offset: f / 36 });
  }

  var packet = new THREE.Mesh(
    new THREE.SphereGeometry(.17, 24, 24),
    new THREE.MeshStandardMaterial({ color: PRIMARY, emissive: PRIMARY, emissiveIntensity: .5 })
  );
  scene.add(packet);
  var packetT = 0;

  var inkColor = new THREE.Color(INK);
  var primaryColor = new THREE.Color(PRIMARY);
  var lookAt = points[0].clone();
  var cameraGoal = new THREE.Vector3();
  var projected = new THREE.Vector3();
  var width = 1;
  var height = 1;

  function resize() {
    width = $stage.clientWidth;
    height = $stage.clientHeight;
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  function placeLabels() {
    nodes.forEach(function (node, i) {
      projected.copy(node.group.position);
      projected.y += 2.35;
      projected.project(camera);
      var visible = projected.z < 1 && Math.abs(projected.x) < 1.1 && Math.abs(projected.y) < 1.1;
      labels[i].style.display = visible ? "" : "none";
      labels[i].style.transform = "translate(-50%, -50%) translate(" +
        ((projected.x + 1) / 2 * width).toFixed(1) + "px," + ((1 - projected.y) / 2 * height).toFixed(1) + "px)";
    });
  }

  var previous = performance.now();

  function frame(now) {
    var dt = Math.min((now - previous) / 1000, .1);
    previous = now;
    var ease = reducedMotion ? 1 : 1 - Math.exp(-dt * 3);

    if (playing && now - lastSwitch > STEP_MS) setActive((active + 1) % STEPS.length);

    // 큰 입자: 현재 단계의 위치로 경로를 따라 이동
    packetT += (active / (STEPS.length - 1) - packetT) * ease;
    curve.getPoint(Math.min(Math.max(packetT, 0), 1), packet.position);
    packet.position.y += .3;

    flow.forEach(function (p) {
      var t = reducedMotion ? p.offset : (p.offset + now * .00003) % 1;
      curve.getPoint(t, p.mesh.position);
      p.mesh.position.y += .12;
    });

    nodes.forEach(function (node, i) {
      node.glow += ((i === active ? 1 : 0) - node.glow) * ease;
      node.material.color.copy(inkColor).lerp(primaryColor, node.glow);
      node.model.scale.setScalar(1 + node.glow * .3);
      if (!reducedMotion) {
        // 문서·창처럼 납작한 도형이 옆면만 보이지 않도록 한 바퀴 돌리지 않고 좌우로만 흔든다.
        node.model.rotation.y = Math.sin(now / 1100 + i) * (.3 + node.glow * .35);
        node.model.position.y = 1.15 + Math.sin(now / 700 + i) * .07;
      }
    });

    // 카메라는 큰 입자를 따라가며 천천히 좌우로 움직인다. 좁은 화면에서는 더 멀리서 본다.
    var distance = camera.aspect < 1 ? 13 : 9.5;
    var sway = reducedMotion ? 0 : Math.sin(now / 4000) * 1.6;
    cameraGoal.set(packet.position.x + sway, 4.4, packet.position.z + distance);
    camera.position.lerp(cameraGoal, ease);
    lookAt.lerp(packet.position, ease);
    camera.lookAt(lookAt.x, .9, lookAt.z);

    renderer.render(scene, camera);
    placeLabels();
    requestAnimationFrame(frame);
  }

  // 도형을 누르면 그 단계로 이동
  var raycaster = new THREE.Raycaster();
  var pointer = new THREE.Vector2();

  renderer.domElement.addEventListener("click", function (e) {
    var rect = renderer.domElement.getBoundingClientRect();
    pointer.set((e.clientX - rect.left) / rect.width * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    var hit = raycaster.intersectObjects(nodes.map(function (n) { return n.group; }), true)[0];
    if (!hit) return;
    setPlaying(false);
    setActive(hit.object.userData.step);
  });

  window.addEventListener("resize", resize);
  resize();
  camera.position.set(points[0].x, 4.4, points[0].z + 9.5);
  requestAnimationFrame(frame);
})();
