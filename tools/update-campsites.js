// 캠핑장 데이터 업데이트 스크립트.
// 네이버 지도의 "<지역> 캠핑장" 검색 결과를 다시 읽어 data/campsites.js 를 새로 만든다.
//
// 실행:   npm run update        (또는 node tools/update-campsites.js)
// 옵션:   --force   수집 결과가 평소보다 크게 줄었어도 덮어쓴다
//
// 필요한 것: Node.js 18 이상. 추가 설치나 API 키는 필요 없다.
// 주의: 네이버 페이지의 내부 구조에 의존하므로, 네이버가 화면을 개편하면 수정이 필요하다.

"use strict";

const fs = require("fs");
const path = require("path");

const DATA_FILE = path.join(__dirname, "..", "data", "campsites.js");
const BACKUP_FILE = path.join(__dirname, "..", "data", "campsites.backup.js");
const DELAY_MS = 1200;       // 요청 사이 간격
const MIN_KEEP_RATIO = 0.7;  // 새 결과가 기존의 이 비율보다 적으면 이상으로 보고 중단
const FORCE = process.argv.includes("--force");

// 검색할 지역: 17개 시·도 + 주요 시·군
const QUERIES = [
  "서울", "인천", "경기", "강원", "충북", "충남", "대전", "세종", "전북", "전남", "광주광역시", "경북", "대구", "경남", "부산", "울산", "제주",
  "수원", "용인", "화성", "평택", "안산", "안성", "이천", "여주", "양평", "가평", "포천", "연천", "파주", "고양", "양주", "남양주", "경기 광주", "김포", "강화", "영종도",
  "춘천", "홍천", "횡성", "원주", "평창", "영월", "정선", "강릉", "속초", "양양", "강원 고성", "인제", "화천", "철원", "삼척", "동해", "태백",
  "청주", "충주", "제천", "단양", "괴산", "충북 영동", "보은", "태안", "보령", "서산", "당진", "공주", "천안", "아산", "논산", "금산", "부여",
  "전주", "완주", "무주", "전북 진안", "군산", "부안", "남원", "여수", "순천", "담양", "구례", "해남", "고흥", "장성", "완도",
  "경주", "포항", "안동", "문경", "영덕", "울진", "청도", "칠곡", "영주", "봉화",
  "거제", "남해", "통영", "산청", "합천", "밀양", "양산", "김해", "창원", "하동", "거창", "경남 고성", "서귀포", "제주시", "기장", "울주"
];

// 주소 앞부분 → 지역 필터 이름
const REGIONS = [
  ["서울", "서울"], ["인천", "인천"], ["경기", "경기"], ["강원", "강원"],
  ["충북", "충북"], ["충청북도", "충북"], ["충남", "충남"], ["충청남도", "충남"],
  ["대전", "대전"], ["세종", "세종"],
  ["전북", "전북"], ["전라북도", "전북"],
  ["전남광주", "전남광주"], ["전남", "전남광주"], ["전라남도", "전남광주"], ["광주", "전남광주"],
  ["경북", "경북"], ["경상북도", "경북"], ["대구", "대구"],
  ["경남", "경남"], ["경상남도", "경남"], ["부산", "부산"], ["울산", "울산"], ["제주", "제주"]
];
const REGION_ORDER = ["서울", "인천", "경기", "강원", "충북", "충남", "대전", "세종", "전북", "전남광주", "경북", "대구", "경남", "부산", "울산", "제주"];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function regionOf(address) {
  const hit = REGIONS.find((r) => address.startsWith(r[0]));
  return hit ? hit[1] : "";
}

function today() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
}

// 검색 결과 페이지에 들어 있는 데이터(__APOLLO_STATE__)에서 장소 목록을 꺼낸다.
async function search(query) {
  const url = "https://pcmap.place.naver.com/place/list?query=" + encodeURIComponent(query + " 캠핑장");
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
      "Accept-Language": "ko-KR,ko;q=0.9"
    }
  });
  if (!res.ok) throw new Error("HTTP " + res.status);

  const html = await res.text();
  const match = html.match(/window\.__APOLLO_STATE__\s*=\s*(\{.*?\});\s*\n/s);
  if (!match) throw new Error("검색 결과 데이터를 찾지 못했습니다 (페이지 구조 변경 가능성)");

  const state = JSON.parse(match[1]);
  return Object.keys(state)
    .filter((key) => key.startsWith("AccommodationSearchItem:"))
    .map((key) => state[key])
    .filter((v) => v && v.name && v.x && v.y);
}

async function searchWithRetry(query) {
  try {
    return await search(query);
  } catch (err) {
    await sleep(3000);
    return search(query);
  }
}

// 네이버 항목 하나를 사이트에서 쓰는 형태로 바꾼다. 캠핑 업종이 아니거나 주소를 알 수 없으면 null.
function toSite(v) {
  if (v.businessCategory !== "camping") return null;

  const address = v.commonAddress
    ? (v.commonAddress + " " + (v.roadAddress || v.address || "")).trim()
    : (v.address || "").trim();
  const region = regionOf(address);
  if (!region) return null;

  const fac = (v.facility || []).slice(0, 14);
  const type = fac.includes("오토캠핑") ? "오토캠핑" : fac.includes("글램핑") ? "글램핑" : fac.includes("카라반") ? "카라반" : "캠핑";

  const site = { id: v.id, name: v.name, region, address, lat: +(+v.y).toFixed(6), lng: +(+v.x).toFixed(6), type };
  const tel = v.phone || v.virtualPhone;
  const blog = Number(String(v.blogCafeReviewCount || "").replace(/,/g, ""));

  if (fac.length) site.facilities = fac;
  if (tel) site.tel = tel;
  if (v.microReview) site.description = v.microReview;
  if (Number(v.placeReviewCount) > 0) site.reviews = Number(v.placeReviewCount);
  if (blog > 0) site.blog = blog;
  if (Number(v.placeReviewScore) > 0) site.rating = Number(v.placeReviewScore);
  if (Number(v.matchRoomMinPrice) > 0) site.price = Number(v.matchRoomMinPrice);
  if (v.imageUrl) site.image = v.imageUrl;
  if (v.hasBooking) site.booking = true;
  return site;
}

function previousIds() {
  if (!fs.existsSync(DATA_FILE)) return new Set();
  const text = fs.readFileSync(DATA_FILE, "utf8");
  return new Set(Array.from(text.matchAll(/^\{"id":"([^"]+)"/gm), (m) => m[1]));
}

function fileContent(sites, date) {
  const head = [
    "// 캠핑장 데이터. file:// 로 바로 열어도 동작하도록 JSON 대신 전역 변수로 둔다.",
    "// tools/update-campsites.js 가 네이버 지도의 \"<지역> 캠핑장\" 검색 결과(17개 시·도 + 주요 시·군)로 만든 파일이다 (" + date + ").",
    "// 직접 고치지 말고 스크립트를 다시 실행한다. 값이 없는 필드는 생략되어 있다.",
    "//",
    "// 필드",
    "//   id          네이버 플레이스 ID",
    "//   name        캠핑장 이름",
    "//   region      시·도 (지역 필터에 사용)",
    "//   address     주소",
    "//   lat, lng    위도, 경도",
    "//   type        유형 (오토캠핑, 글램핑, 카라반, 캠핑)",
    "//   facilities  시설·특징 목록",
    "//   tel         전화번호",
    "//   description 네이버 플레이스의 리뷰 한줄 요약",
    "//   reviews     방문자 리뷰 수",
    "//   blog        블로그·카페 리뷰 수",
    "//   rating      별점 (5점 만점, 네이버가 제공하는 곳만)",
    "//   price       수집 시점의 1박 최저가 (원)",
    "//   image       대표 사진 URL",
    "//   booking     네이버 예약 가능 여부",
    "window.CAMPSITES_SOURCE = \"naver\";",
    "window.CAMPSITES_DATE = \"" + date + "\";",
    "window.CAMPSITE_REGIONS = " + JSON.stringify(REGION_ORDER) + ";",
    "",
    "window.CAMPSITES = [\n"
  ].join("\n");
  return head + sites.map((s) => JSON.stringify(s)).join(",\n") + "\n];\n";
}

async function main() {
  const found = new Map();
  const failed = [];

  for (let i = 0; i < QUERIES.length; i++) {
    const query = QUERIES[i];
    try {
      const items = await searchWithRetry(query);
      items.forEach((v) => { if (!found.has(v.id)) found.set(v.id, v); });
      console.log("[" + (i + 1) + "/" + QUERIES.length + "] " + query + ": " + items.length + "건 (누적 " + found.size + ")");
    } catch (err) {
      failed.push(query);
      console.log("[" + (i + 1) + "/" + QUERIES.length + "] " + query + ": 실패 - " + err.message);
    }
    await sleep(DELAY_MS);
  }

  const sites = Array.from(found.values()).map(toSite).filter(Boolean)
    .sort((a, b) => (b.reviews || 0) - (a.reviews || 0));

  const before = previousIds();
  const added = sites.filter((s) => !before.has(s.id)).length;
  const after = new Set(sites.map((s) => s.id));
  const removed = Array.from(before).filter((id) => !after.has(id)).length;

  console.log("");
  console.log("수집 결과: 캠핑장 " + sites.length + "곳 (기존 " + before.size + "곳, 신규 " + added + ", 빠짐 " + removed + ")");
  if (failed.length) console.log("실패한 검색 " + failed.length + "건: " + failed.join(", "));

  // 네이버 구조 변경이나 차단으로 결과가 급감했을 때 멀쩡한 데이터를 덮어쓰지 않는다.
  const tooFew = before.size > 0 && sites.length < before.size * MIN_KEEP_RATIO;
  const tooManyFailures = failed.length > QUERIES.length * 0.1;
  if ((tooFew || tooManyFailures || sites.length === 0) && !FORCE) {
    console.log("결과가 평소와 크게 달라 기존 파일을 그대로 두었습니다. 확인 후 덮어쓰려면 --force 옵션으로 다시 실행하세요.");
    process.exitCode = 1;
    return;
  }

  if (fs.existsSync(DATA_FILE)) fs.copyFileSync(DATA_FILE, BACKUP_FILE);
  fs.writeFileSync(DATA_FILE, fileContent(sites, today()));
  console.log("저장 완료: " + path.relative(process.cwd(), DATA_FILE) + " (이전 파일은 campsites.backup.js 로 보관)");
}

main().catch((err) => {
  console.error("업데이트 실패:", err);
  process.exitCode = 1;
});
