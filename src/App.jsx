import { useState, useEffect, useRef, useCallback } from "react";

const CLUBS = [
  { id: "driver", label: "Driver", abbr: "Dr", color: "#c8a96e" },
  { id: "3w", label: "3 Wood", abbr: "3W", color: "#b8956a" },
  { id: "5w", label: "5 Wood", abbr: "5W", color: "#a88266" },
  { id: "4h", label: "4 Hybrid", abbr: "4H", color: "#8fb3a8" },
  { id: "4i", label: "4 Iron", abbr: "4i", color: "#7a9e93" },
  { id: "5i", label: "5 Iron", abbr: "5i", color: "#6a8e83" },
  { id: "6i", label: "6 Iron", abbr: "6i", color: "#5a7e73" },
  { id: "7i", label: "7 Iron", abbr: "7i", color: "#4a6e63" },
  { id: "8i", label: "8 Iron", abbr: "8i", color: "#3a5e53" },
  { id: "9i", label: "9 Iron", abbr: "9i", color: "#2a4e43" },
  { id: "pw", label: "Pitching Wedge", abbr: "PW", color: "#c45c3b" },
  { id: "gw", label: "Gap Wedge", abbr: "GW", color: "#b84c2b" },
  { id: "sw", label: "Sand Wedge", abbr: "SW", color: "#ac3c1b" },
  { id: "lw", label: "Lob Wedge", abbr: "LW", color: "#a02c0b" },
  { id: "putter", label: "Putter", abbr: "Pt", color: "#888" },
];

const SHOT_RESULTS = ["Fairway", "Green", "Rough", "Bunker", "Penalty", "OB"];
const SHOT_SHAPES = ["Straight", "Draw", "Fade", "Hook", "Slice", "Push", "Pull"];

const SAMPLE_COURSES = [
  { id: 7, name: "River Pines", tee: "Blue", rating: 69.4, slope: 127, par: 70, location: "Johns Creek, GA", yards: 6284 },
  { id: 11, name: "St. Marlo CC", tee: "Blue", rating: 72.7, slope: 138, par: 72, location: "Duluth, GA", yards: 6500 },
  { id: 12, name: "RTJ Grand National — Links", tee: "Purple", rating: 76.2, slope: 141, par: 72, location: "Opelika, AL", yards: 7404 },
];

const INITIAL_ROUND = {
  course: null,
  date: new Date().toISOString().split("T")[0],
  tee: "White",
  holes: Array.from({ length: 18 }, (_, i) => ({
    number: i + 1,
    par: i < 9 ? [4, 3, 5, 4, 4, 3, 4, 5, 4][i] : [4, 3, 5, 4, 4, 3, 4, 5, 4][i - 9],
    shots: [],
    score: i < 9 ? [4, 3, 5, 4, 4, 3, 4, 5, 4][i] : [4, 3, 5, 4, 4, 3, 4, 5, 4][i - 9], // default to par
    putts: 0,
    notes: "",
    fairwayHit: null, // true | false | null (par 3s = null)
  })),
};

// Haversine formula — returns distance in yards between two lat/lng coords
function haversineYards(lat1, lon1, lat2, lon2) {
  const R = 6371000; // meters
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  const meters = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(meters * 1.09361);
}

// GPS Hook — tracks position continuously while active
function useGPS() {
  const [pos, setPos] = useState(null);
  const [error, setError] = useState(null);
  const [watching, setWatching] = useState(false);
  const watchId = useRef(null);

  const startWatch = useCallback(() => {
    if (!navigator.geolocation) {
      setError("GPS not available on this device.");
      return;
    }
    setError(null);
    setWatching(true);
    watchId.current = navigator.geolocation.watchPosition(
      (p) => setPos({ lat: p.coords.latitude, lng: p.coords.longitude, acc: Math.round(p.coords.accuracy) }),
      (e) => setError(e.message),
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 10000 }
    );
  }, []);

  const stopWatch = useCallback(() => {
    if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
    setWatching(false);
  }, []);

  const getOnce = useCallback(() => new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error("GPS not available")); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, acc: Math.round(p.coords.accuracy) }),
      reject,
      { enableHighAccuracy: true, maximumAge: 0, timeout: 12000 }
    );
  }), []);

  useEffect(() => () => { if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current); }, []);

  return { pos, error, watching, startWatch, stopWatch, getOnce };
}

// GPS Shot Distance Widget — embedded in the shot modal
// MapShotTracker — tap-to-mark ball position, auto-calculates distance + score
function MapShotTracker({ hole, onUpdateHole }) {
  const { getOnce } = useGPS();
  const [teePos, setTeePos] = useState(null);
  const [marks, setMarks] = useState(hole.mapMarks || []); // [{lat, lng, lieType, club}]
  const [mapImgError, setMapImgError] = useState(false);
  const [pendingTap, setPendingTap] = useState(null); // {x, y} normalized 0-1 within map box
  const [pendingClub, setPendingClub] = useState(null);
  const [pendingLie, setPendingLie] = useState(null);
  const [lastConfirmedShot, setLastConfirmedShot] = useState(null);
  const [capturing, setCapturing] = useState(false);
  const mapRef = useRef(null);

  useEffect(() => {
    setMarks(hole.mapMarks || []);
  }, [hole.number]);

  const captureTeePosition = async () => {
    setCapturing(true);
    try {
      const pos = await getOnce();
      setTeePos(pos);
    } catch (e) { console.error(e); }
    setCapturing(false);
  };

  // Simulate a tap-to-GPS by capturing current device GPS at moment of tap
  // (real ball-marking needs the user standing at the ball when they tap)
  const handleMapTap = async (e) => {
    const rect = mapRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    setPendingTap({ x, y });
  };

  const confirmShotMark = async (shape) => {
    setCapturing(true);
    try {
      const pos = await getOnce();
      const prevPos = marks.length > 0 ? marks[marks.length - 1] : teePos;
      const dist = prevPos ? haversineYards(prevPos.lat, prevPos.lng, pos.lat, pos.lng) : null;
      const newMark = { lat: pos.lat, lng: pos.lng, x: pendingTap.x, y: pendingTap.y, lieType: pendingLie, club: pendingClub, shape, distance: dist, shotNum: marks.length + 1 };
      const updatedMarks = [...marks, newMark];
      setMarks(updatedMarks);
      onUpdateHole({ mapMarks: updatedMarks, score: updatedMarks.length + (hole.putts || 0) });
      setLastConfirmedShot(newMark);
      setPendingTap(null);
      setPendingClub(null);
      setPendingLie(null);
      setTimeout(() => setLastConfirmedShot(null), 3500);
    } catch (e) { console.error(e); }
    setCapturing(false);
  };

  const removeMark = (idx) => {
    const updated = marks.filter((_, i) => i !== idx).map((m, i) => ({ ...m, shotNum: i + 1 }));
    setMarks(updated);
    onUpdateHole({ mapMarks: updated, score: updated.length + (hole.putts || 0) });
  };

  const totalShots = marks.length;
  const totalDist = marks.reduce((s, m) => s + (m.distance || 0), 0);

  return (
    <div style={mapStyles.wrap}>
      {!teePos ? (
        <div style={mapStyles.teeCapture}>
          <div style={mapStyles.teeCaptureText}>Stand at the tee box, then capture your starting position</div>
          <button style={mapStyles.teeBtn} onClick={captureTeePosition} disabled={capturing}>
            {capturing ? "Getting GPS…" : "📍 Set Tee Position"}
          </button>
        </div>
      ) : (
        <>
          {/* Map Canvas */}
          <div ref={mapRef} style={mapStyles.mapBox} onClick={handleMapTap}>
            {!mapImgError ? (
              <img
                src={`https://maps.googleapis.com/maps/api/staticmap?center=${teePos.lat},${teePos.lng}&zoom=17&size=480x480&maptype=satellite&key=AIzaSyBaTagO6o0y9txUbyd9wdJcxzVPjJVcXWA`}
                alt="Hole satellite view"
                style={mapStyles.mapImg}
                onError={() => setMapImgError(true)}
              />
            ) : (
              <div style={mapStyles.mapFallback}>
                <div style={mapStyles.mapFallbackIcon}>🛰️</div>
                <div style={mapStyles.mapFallbackText}>Satellite view needs a Maps API key.<br />Tap anywhere below to mark your shot — distance is still calculated from real GPS.</div>
              </div>
            )}

            {/* Tee marker */}
            <div style={{ ...mapStyles.pin, left: "50%", top: "50%", background: "#4caf80" }}>⛳</div>

            {/* Shot markers */}
            {marks.map((m, i) => (
              <div key={i}
                style={{ ...mapStyles.pin, left: `${m.x * 100}%`, top: `${m.y * 100}%`, background: lieColor(m.lieType) }}
                onClick={(e) => { e.stopPropagation(); removeMark(i); }}>
                {CLUBS.find(c => c.id === m.club)?.abbr || m.shotNum}
              </div>
            ))}

            {/* Pending tap marker */}
            {pendingTap && (
              <div style={{ ...mapStyles.pin, left: `${pendingTap.x * 100}%`, top: `${pendingTap.y * 100}%`, background: "#c8a96e", animation: "none" }}>
                ?
              </div>
            )}
          </div>

          {/* Club + Lie + Shape picker for pending tap */}
          {pendingTap && !pendingClub && (
            <div style={mapStyles.liePicker}>
              <div style={mapStyles.liePickerLabel}>What club did you hit?</div>
              <div style={mapStyles.clubGrid}>
                {CLUBS.map(c => (
                  <button key={c.id}
                    style={{ ...mapStyles.clubChip, background: c.color + "22", borderColor: c.color }}
                    onClick={() => setPendingClub(c.id)}>
                    {c.abbr}
                  </button>
                ))}
              </div>
              <button style={mapStyles.lieCancelBtn} onClick={() => setPendingTap(null)}>Cancel</button>
            </div>
          )}

          {pendingTap && pendingClub && !pendingLie && (
            <div style={mapStyles.liePicker}>
              <div style={mapStyles.liePickerLabel}>Where did it land?</div>
              <div style={mapStyles.lieChips}>
                {["Fairway", "Rough", "Bunker", "Green", "Penalty", "OB"].map(lie => (
                  <button key={lie} style={{ ...mapStyles.lieChip, background: lieColor(lie) + "22", borderColor: lieColor(lie) }}
                    onClick={() => setPendingLie(lie)}>
                    {lie}
                  </button>
                ))}
              </div>
              <div style={mapStyles.liePickerRow}>
                <button style={mapStyles.lieBackBtn} onClick={() => setPendingClub(null)}>← Change Club</button>
                <button style={mapStyles.lieCancelBtn} onClick={() => { setPendingTap(null); setPendingClub(null); }}>Cancel</button>
              </div>
            </div>
          )}

          {pendingTap && pendingClub && pendingLie && (
            <div style={mapStyles.liePicker}>
              <div style={mapStyles.liePickerLabel}>Shot shape?</div>
              <div style={mapStyles.lieChips}>
                {SHOT_SHAPES.map(shape => (
                  <button key={shape} style={mapStyles.shapeChip}
                    onClick={() => confirmShotMark(shape)} disabled={capturing}>
                    {shape}
                  </button>
                ))}
              </div>
              <div style={mapStyles.liePickerRow}>
                <button style={mapStyles.lieBackBtn} onClick={() => setPendingLie(null)}>← Change Lie</button>
                <button style={mapStyles.lieCancelBtn} onClick={() => { setPendingTap(null); setPendingClub(null); setPendingLie(null); }}>Cancel</button>
              </div>
              {capturing && <div style={mapStyles.capturingNote}>Getting GPS fix…</div>}
            </div>
          )}

          {/* Last shot confirmation toast */}
          {lastConfirmedShot && (
            <div style={mapStyles.shotToast}>
              <span style={mapStyles.shotToastIcon}>✓</span>
              <span style={mapStyles.shotToastText}>
                {CLUBS.find(c => c.id === lastConfirmedShot.club)?.label} · {lastConfirmedShot.shape} · {lastConfirmedShot.lieType}
                {lastConfirmedShot.distance ? ` · ${lastConfirmedShot.distance}y` : ""}
              </span>
            </div>
          )}

          {/* Shot summary */}
          <div style={mapStyles.summary}>
            <div style={mapStyles.summaryStat}>
              <div style={mapStyles.summaryNum}>{totalShots}</div>
              <div style={mapStyles.summaryLabel}>Shots</div>
            </div>
            <div style={mapStyles.summaryStat}>
              <div style={mapStyles.summaryNum}>{hole.putts || 0}</div>
              <div style={mapStyles.summaryLabel}>Putts</div>
            </div>
            <div style={mapStyles.summaryStat}>
              <div style={{ ...mapStyles.summaryNum, color: "#c8a96e" }}>{totalShots + (hole.putts || 0)}</div>
              <div style={mapStyles.summaryLabel}>Score</div>
            </div>
            <div style={mapStyles.summaryStat}>
              <div style={mapStyles.summaryNum}>{totalDist || "—"}</div>
              <div style={mapStyles.summaryLabel}>Total Yds</div>
            </div>
          </div>

          {/* Putts stepper inline */}
          <div style={mapStyles.puttsRow}>
            <span style={mapStyles.puttsLabel}>Putts</span>
            <div style={mapStyles.puttsStepper}>
              <button style={mapStyles.puttsBtn} onClick={() => onUpdateHole({ putts: Math.max(0, (hole.putts || 0) - 1), score: totalShots + Math.max(0, (hole.putts || 0) - 1) })}>−</button>
              <span style={mapStyles.puttsVal}>{hole.putts || 0}</span>
              <button style={mapStyles.puttsBtn} onClick={() => onUpdateHole({ putts: (hole.putts || 0) + 1, score: totalShots + (hole.putts || 0) + 1 })}>+</button>
            </div>
          </div>

          {/* Shot list */}
          {marks.length > 0 && (
            <div style={mapStyles.shotList}>
              {marks.map((m, i) => (
                <div key={i} style={mapStyles.shotListRow}>
                  <span style={{ ...mapStyles.shotListDot, background: lieColor(m.lieType) }}>{m.shotNum}</span>
                  <span style={mapStyles.shotListClub}>{CLUBS.find(c => c.id === m.club)?.abbr || "—"}</span>
                  <span style={mapStyles.shotListText}>{m.shape ? `${m.shape} · ` : ""}{m.lieType}{m.distance ? ` · ${m.distance}y` : ""}</span>
                  <button style={mapStyles.shotListRemove} onClick={() => removeMark(i)}>✕</button>
                </div>
              ))}
            </div>
          )}

          <button style={mapStyles.resetTeeBtn} onClick={() => { setTeePos(null); setMarks([]); setPendingTap(null); setPendingClub(null); setPendingLie(null); onUpdateHole({ mapMarks: [], score: hole.par, putts: 0 }); }}>
            Reset Tee Position
          </button>
        </>
      )}
    </div>
  );
}

function lieColor(lie) {
  const colors = { Fairway: "#4caf80", Rough: "#a89858", Bunker: "#d4a843", Green: "#5a9fd4", Penalty: "#e0954b", OB: "#e05c4b" };
  return colors[lie] || "#888";
}

const mapStyles = {
  wrap: { marginBottom: 12 },
  teeCapture: { background: "#0e1520", border: "1px solid #1e2a3a", borderRadius: 12, padding: "24px 20px", textAlign: "center" },
  teeCaptureText: { fontSize: 13, color: "#888", marginBottom: 16, lineHeight: 1.6 },
  teeBtn: { background: "#c8a96e", border: "none", borderRadius: 8, padding: "12px 24px", color: "#1a0f05", fontWeight: 700, fontSize: 14, cursor: "pointer" },
  mapBox: { position: "relative", width: "100%", aspectRatio: "1", background: "#1a2a1a", borderRadius: 12, overflow: "hidden", border: "1px solid #2a3545", cursor: "crosshair" },
  mapImg: { width: "100%", height: "100%", objectFit: "cover" },
  mapFallback: { width: "100%", height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 20, background: "linear-gradient(135deg, #1a2a1a, #14201a)" },
  mapFallbackIcon: { fontSize: 36, marginBottom: 10 },
  mapFallbackText: { fontSize: 12, color: "#789078", textAlign: "center", lineHeight: 1.6 },
  pin: { position: "absolute", width: 28, height: 28, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 700, fontSize: 12, transform: "translate(-50%, -50%)", border: "2px solid #fff", boxShadow: "0 2px 6px rgba(0,0,0,0.4)", cursor: "pointer" },
  liePicker: { background: "#0e1520", border: "1px solid #c8a96e55", borderRadius: 10, padding: "14px", marginTop: 10 },
  liePickerLabel: { fontSize: 12, color: "#c8a96e", marginBottom: 10, fontWeight: 600 },
  liePickerRow: { display: "flex", gap: 8 },
  clubGrid: { display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 },
  clubChip: { padding: "8px 12px", border: "1px solid", borderRadius: 8, color: "#e8e0d0", fontSize: 13, cursor: "pointer", fontFamily: "Georgia, serif", fontWeight: 600 },
  lieChips: { display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 },
  lieChip: { padding: "8px 14px", border: "1px solid", borderRadius: 20, color: "#e8e0d0", fontSize: 13, cursor: "pointer", fontFamily: "Georgia, serif" },
  shapeChip: { padding: "8px 14px", border: "1px solid #2a3545", background: "#1a2030", borderRadius: 20, color: "#e8e0d0", fontSize: 13, cursor: "pointer", fontFamily: "Georgia, serif" },
  capturingNote: { fontSize: 11, color: "#c8a96e", marginTop: 8, fontStyle: "italic" },
  shotToast: { display: "flex", alignItems: "center", gap: 8, background: "#1a2a1a", border: "1px solid #4caf8077", borderRadius: 8, padding: "10px 14px", marginTop: 10 },
  shotToastIcon: { color: "#4caf80", fontWeight: 700 },
  shotToastText: { fontSize: 12, color: "#cde8d8" },
  lieCancelBtn: { background: "none", border: "1px solid #2a3545", color: "#666", borderRadius: 6, padding: "6px 14px", fontSize: 12, cursor: "pointer" },
  lieBackBtn: { background: "none", border: "1px solid #2a3545", color: "#c8a96e", borderRadius: 6, padding: "6px 14px", fontSize: 12, cursor: "pointer" },
  summary: { display: "flex", justifyContent: "space-between", background: "#0e1520", border: "1px solid #1e2a3a", borderRadius: 10, padding: "12px 8px", marginTop: 10 },
  summaryStat: { textAlign: "center", flex: 1 },
  summaryNum: { fontSize: 22, fontWeight: 800, color: "#fff" },
  summaryLabel: { fontSize: 10, color: "#666", letterSpacing: 1, textTransform: "uppercase", marginTop: 2 },
  puttsRow: { display: "flex", justifyContent: "space-between", alignItems: "center", background: "#0e1520", border: "1px solid #1e2a3a", borderRadius: 10, padding: "10px 16px", marginTop: 8 },
  puttsLabel: { fontSize: 12, color: "#888", letterSpacing: 1, textTransform: "uppercase" },
  puttsStepper: { display: "flex", alignItems: "center", gap: 14 },
  puttsBtn: { width: 32, height: 32, borderRadius: 8, background: "#1a2030", border: "1px solid #2a3545", color: "#e8e0d0", fontSize: 18, cursor: "pointer" },
  puttsVal: { fontSize: 18, fontWeight: 700, color: "#fff", minWidth: 20, textAlign: "center" },
  shotList: { marginTop: 8 },
  shotListRow: { display: "flex", alignItems: "center", gap: 10, background: "#0e1520", borderRadius: 8, padding: "8px 12px", marginBottom: 4, border: "1px solid #1a2030" },
  shotListDot: { width: 22, height: 22, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 11, fontWeight: 700, flexShrink: 0 },
  shotListClub: { fontSize: 11, color: "#c8a96e", fontWeight: 700, minWidth: 24 },
  shotListText: { flex: 1, fontSize: 12, color: "#aaa" },
  shotListRemove: { background: "none", border: "none", color: "#666", fontSize: 13, cursor: "pointer", padding: "0 4px" },
  resetTeeBtn: { width: "100%", marginTop: 10, background: "none", border: "1px solid #2a3545", color: "#666", borderRadius: 8, padding: "8px 0", fontSize: 12, cursor: "pointer" },
};


function GPSDistanceCapture({ onDistanceCaptured }) {
  const { pos, error, watching, startWatch, stopWatch, getOnce } = useGPS();
  const [phase, setPhase] = useState("idle"); // idle | waiting-start | start-set | waiting-end | done
  const [startCoord, setStartCoord] = useState(null);
  const [endCoord, setEndCoord] = useState(null);
  const [measuredYards, setMeasuredYards] = useState(null);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [accuracyWarning, setAccuracyWarning] = useState(false);

  const pinStart = async () => {
    setGpsLoading(true);
    setAccuracyWarning(false);
    try {
      const coord = await getOnce();
      if (coord.acc > 15) setAccuracyWarning(true);
      setStartCoord(coord);
      setPhase("start-set");
    } catch (e) {
      console.error(e);
    }
    setGpsLoading(false);
  };

  const pinEnd = async () => {
    setGpsLoading(true);
    setAccuracyWarning(false);
    try {
      const coord = await getOnce();
      if (coord.acc > 15) setAccuracyWarning(true);
      setEndCoord(coord);
      const yards = haversineYards(startCoord.lat, startCoord.lng, coord.lat, coord.lng);
      setMeasuredYards(yards);
      setPhase("done");
      onDistanceCaptured(yards);
    } catch (e) {
      console.error(e);
    }
    setGpsLoading(false);
  };

  const reset = () => {
    setPhase("idle");
    setStartCoord(null);
    setEndCoord(null);
    setMeasuredYards(null);
    setAccuracyWarning(false);
  };

  return (
    <div style={gpsStyles.wrap}>
      <div style={gpsStyles.header}>
        <span style={gpsStyles.icon}>📡</span>
        <span style={gpsStyles.title}>GPS Distance</span>
        {phase === "done" && measuredYards && (
          <span style={gpsStyles.badge}>{measuredYards}y</span>
        )}
      </div>

      {error && <div style={gpsStyles.error}>⚠ {error}</div>}

      {phase === "idle" && (
        <div style={gpsStyles.steps}>
          <div style={gpsStyles.stepInactive}>① Stand at ball address position</div>
          <div style={gpsStyles.stepInactive}>② Pin Start → hit your shot → walk to ball</div>
          <div style={gpsStyles.stepInactive}>③ Pin End → distance auto-calculates</div>
          <button style={gpsStyles.btn} onClick={pinStart} disabled={gpsLoading}>
            {gpsLoading ? "Getting GPS…" : "📍 Pin Start"}
          </button>
        </div>
      )}

      {phase === "start-set" && (
        <div style={gpsStyles.steps}>
          {accuracyWarning && <div style={gpsStyles.warn}>Low accuracy ({startCoord?.acc}m). Move to open sky.</div>}
          <div style={gpsStyles.stepDone}>✓ Start pinned ({startCoord?.acc}m accuracy)</div>
          <div style={gpsStyles.stepActive}>Now hit your shot, then walk to where the ball lands</div>
          <button style={gpsStyles.btn} onClick={pinEnd} disabled={gpsLoading}>
            {gpsLoading ? "Getting GPS…" : "🏌️ Pin End (Ball Landed)"}
          </button>
        </div>
      )}

      {phase === "done" && (
        <div style={gpsStyles.result}>
          <div style={gpsStyles.yardsBig}>{measuredYards}</div>
          <div style={gpsStyles.yardsLabel}>YARDS</div>
          {accuracyWarning && <div style={gpsStyles.warn}>Low accuracy reading — verify manually</div>}
          <div style={gpsStyles.coordSmall}>
            Start: {startCoord?.lat.toFixed(5)}, {startCoord?.lng.toFixed(5)}<br />
            End: {endCoord?.lat.toFixed(5)}, {endCoord?.lng.toFixed(5)}
          </div>
          <button style={gpsStyles.resetBtn} onClick={reset}>Re-measure</button>
        </div>
      )}
    </div>
  );
}

const gpsStyles = {
  wrap: { background: "#0a1220", border: "1px solid #c8a96e55", borderRadius: 10, padding: "14px 16px", marginTop: 4 },
  header: { display: "flex", alignItems: "center", gap: 8, marginBottom: 12 },
  icon: { fontSize: 16 },
  title: { fontSize: 12, letterSpacing: 2, color: "#c8a96e", textTransform: "uppercase", flex: 1 },
  badge: { background: "#c8a96e", color: "#1a0f05", fontWeight: 800, fontSize: 13, padding: "2px 8px", borderRadius: 12 },
  steps: { display: "flex", flexDirection: "column", gap: 6 },
  stepInactive: { fontSize: 12, color: "#555", paddingLeft: 4 },
  stepDone: { fontSize: 12, color: "#4caf80", paddingLeft: 4 },
  stepActive: { fontSize: 12, color: "#e8e0d0", paddingLeft: 4, marginBottom: 4 },
  btn: { background: "#c8a96e", border: "none", borderRadius: 8, padding: "10px 0", color: "#1a0f05", fontWeight: 700, fontSize: 13, cursor: "pointer", marginTop: 6 },
  result: { textAlign: "center" },
  yardsBig: { fontSize: 56, fontWeight: 900, color: "#c8a96e", lineHeight: 1 },
  yardsLabel: { fontSize: 11, letterSpacing: 4, color: "#888", marginBottom: 8 },
  coordSmall: { fontSize: 10, color: "#444", margin: "8px 0", lineHeight: 1.6 },
  resetBtn: { background: "none", border: "1px solid #444", color: "#888", borderRadius: 6, padding: "6px 14px", fontSize: 12, cursor: "pointer", marginTop: 4 },
  error: { color: "#e05c4b", fontSize: 12, marginBottom: 8 },
  warn: { background: "#3a2000", color: "#f5a623", fontSize: 11, padding: "6px 10px", borderRadius: 6, marginBottom: 6 },
};

export default function GolfTracker() {
  const [view, setView] = useState("home");
  const [rounds, setRounds] = useState(() => {
    try {
      const saved = localStorage.getItem("caddie_rounds");
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [activeRound, setActiveRound] = useState(null);
  const [activeHole, setActiveHole] = useState(0);
  const [showShotModal, setShowShotModal] = useState(false);
  const [pendingShot, setPendingShot] = useState({ club: null, distance: "", result: "Fairway", shape: "Straight", notes: "", gpsDistance: null });
  const [handicapIndex, setHandicapIndex] = useState(null);
  const [loading, setLoading] = useState(false);
  const [aiInsight, setAiInsight] = useState("");
  const [showCourseSelect, setShowCourseSelect] = useState(false);
  const [gpsTab, setGpsTab] = useState("gps"); // gps | manual
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [editingShot, setEditingShot] = useState(null); // { holeIdx, shotId }
  const [swipedShotId, setSwipedShotId] = useState(null);
  const [viewingRound, setViewingRound] = useState(null);
  const [trackMode, setTrackMode] = useState("classic"); // classic | map

  useEffect(() => {
    try { localStorage.setItem("caddie_rounds", JSON.stringify(rounds)); } catch {}
  }, [rounds]);

  useEffect(() => {
    if (rounds.length === 0) return;
    const diffs = rounds
      .filter(r => r.completed && r.course)
      .map(r => {
        const total = r.holes.reduce((s, h) => s + (h.score || h.par), 0);
        const adj = Math.min(total, r.holes.reduce((s, h) => s + h.par + 3, 0));
        return ((adj - r.course.rating) * 113) / r.course.slope;
      });
    if (diffs.length === 0) return;
    const sorted = [...diffs].sort((a, b) => a - b);
    const useCount = Math.min(Math.floor(diffs.length * 0.4) + 1, 8);
    const best = sorted.slice(0, useCount);
    const avg = best.reduce((s, d) => s + d, 0) / best.length;
    setHandicapIndex(Math.floor(avg * 10) / 10);
  }, [rounds]);

  const startRound = (course) => {
    const round = { ...JSON.parse(JSON.stringify(INITIAL_ROUND)), id: Date.now(), course, completed: false };
    setActiveRound(round);
    setActiveHole(0);
    setShowCourseSelect(false);
    setView("round");
  };

  const openShotModal = () => {
    setPendingShot({ club: null, distance: "", result: "Fairway", shape: "Straight", notes: "", gpsDistance: null });
    setEditingShot(null);
    setGpsTab("gps");
    setShowShotModal(true);
  };

  const addShot = () => {
    if (!pendingShot.club) return;
    const dist = pendingShot.gpsDistance || pendingShot.distance;
    const shot = { ...pendingShot, distance: String(dist), id: Date.now() };
    const updated = JSON.parse(JSON.stringify(activeRound));
    updated.holes[activeHole].shots.push(shot);
    setActiveRound(updated);
    setShowShotModal(false);
  };

  const updateScore = (holeIdx, score) => {
    const updated = JSON.parse(JSON.stringify(activeRound));
    updated.holes[holeIdx].score = parseInt(score) || null;
    setActiveRound(updated);
  };

  const updatePutts = (holeIdx, putts) => {
    const updated = JSON.parse(JSON.stringify(activeRound));
    updated.holes[holeIdx].putts = parseInt(putts) || 0;
    setActiveRound(updated);
  };

  const updateNotes = (holeIdx, notes) => {
    const updated = JSON.parse(JSON.stringify(activeRound));
    updated.holes[holeIdx].notes = notes;
    setActiveRound(updated);
  };

  const updateFairway = (holeIdx, hit) => {
    const updated = JSON.parse(JSON.stringify(activeRound));
    updated.holes[holeIdx].fairwayHit = hit;
    setActiveRound(updated);
  };

  const finishRound = () => {
    const completed = { ...activeRound, completed: true };
    setRounds(prev => [completed, ...prev]);
    setActiveRound(null);
    setView("scorecard-view");
    fetchAiInsight(completed);
  };

  const deleteRound = (id) => {
    setRounds(prev => prev.filter(r => r.id !== id));
    setConfirmDeleteId(null);
    if (view === "scorecard-view") setView("home");
  };

  const deleteShot = (holeIdx, shotId) => {
    const updated = JSON.parse(JSON.stringify(activeRound));
    updated.holes[holeIdx].shots = updated.holes[holeIdx].shots.filter(s => s.id !== shotId);
    setActiveRound(updated);
    setSwipedShotId(null);
  };

  const startEditShot = (holeIdx, shot) => {
    setPendingShot({ ...shot });
    setEditingShot({ holeIdx, shotId: shot.id });
    setGpsTab(shot.gpsDistance ? "gps" : "manual");
    setSwipedShotId(null);
    setShowShotModal(true);
  };

  const saveEditShot = () => {
    const dist = pendingShot.gpsDistance || pendingShot.distance;
    const updated = JSON.parse(JSON.stringify(activeRound));
    const hole = updated.holes[editingShot.holeIdx];
    hole.shots = hole.shots.map(s => s.id === editingShot.shotId ? { ...pendingShot, distance: String(dist) } : s);
    setActiveRound(updated);
    setEditingShot(null);
    setShowShotModal(false);
  };

  const fetchAiInsight = async (round) => {
    setLoading(true);
    setAiInsight("");
    try {
      const totalScore = round.holes.reduce((s, h) => s + (h.score || h.par), 0);
      const totalPar = round.holes.reduce((s, h) => s + h.par, 0);
      const allShotsByHole = round.holes.map(h => [
        ...(h.shots || []),
        ...(h.mapMarks || []).map(m => ({ club: m.club, result: m.lieType, gpsDistance: m.distance })),
      ]);
      const clubUsage = {};
      allShotsByHole.forEach(shots => shots.forEach(s => { if (s.club) clubUsage[s.club] = (clubUsage[s.club] || 0) + 1; }));
      const shotResults = {};
      allShotsByHole.forEach(shots => shots.forEach(s => { if (s.result) shotResults[s.result] = (shotResults[s.result] || 0) + 1; }));
      const gpsShots = allShotsByHole.flat().filter(s => s.gpsDistance);
      const avgGpsByClub = {};
      gpsShots.forEach(s => {
        if (!s.club) return;
        if (!avgGpsByClub[s.club]) avgGpsByClub[s.club] = [];
        avgGpsByClub[s.club].push(s.gpsDistance);
      });
      const gpsAvgs = Object.entries(avgGpsByClub).map(([c, ds]) => `${c}: ${Math.round(ds.reduce((a,b)=>a+b,0)/ds.length)}y`).join(", ");

      const prompt = `You are a golf coach reviewing a round. Give 3 sharp, specific insights and 1 practice drill. Be direct, no fluff.

Round data:
- Course: ${round.course?.name}
- Score: ${totalScore} (${totalScore > totalPar ? "+" : ""}${totalScore - totalPar})
- Club frequency: ${JSON.stringify(clubUsage)}
- Shot results: ${JSON.stringify(shotResults)}
- GPS-measured avg distances: ${gpsAvgs || "none recorded"}

Format: 3 bullet insights + 1 "Drill:" paragraph.`;

      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 1000, messages: [{ role: "user", content: prompt }] }),
      });
      const data = await res.json();
      const text = data.content?.filter(b => b.type === "text").map(b => b.text).join("") || "";
      setAiInsight(text);
    } catch (e) {
      setAiInsight("Unable to load AI insights right now.");
    }
    setLoading(false);
  };

  const totalScore = activeRound ? activeRound.holes.reduce((s, h) => s + (h.score || 0), 0) : 0;
  const totalPar = activeRound ? activeRound.holes.reduce((s, h) => s + h.par, 0) : 0;
  const scoreDiff = totalScore - totalPar;

  return (
    <div style={styles.app}>
      <header style={styles.header}>
        <div style={styles.headerLeft}>
          <div style={styles.logo}>⛳</div>
          <div>
            <div style={styles.logoText}>CADDIE</div>
            <div style={styles.logoSub}>USGA · GPS Connected</div>
          </div>
        </div>
        {handicapIndex !== null && (
          <div style={styles.hcapBadge}>
            <div style={styles.hcapLabel}>HCP</div>
            <div style={styles.hcapValue}>{handicapIndex.toFixed(1)}</div>
          </div>
        )}
      </header>

      <nav style={styles.nav}>
        {["home", "stats", "handicap"].map(v => (
          <button key={v}
            style={{ ...styles.navBtn, ...(view === v || (view === "scorecard-view" && v === "home") ? styles.navBtnActive : {}) }}
            onClick={() => setView(v)}>
            {v === "home" ? "Rounds" : v === "stats" ? "My Bag" : "Handicap"}
          </button>
        ))}
      </nav>

      <main style={styles.main}>
        {/* HOME */}
        {(view === "home" || view === "scorecard-view") && !activeRound && (
          <div>
            <div style={styles.sectionHeader}>
              <span style={styles.sectionTitle}>Recent Rounds</span>
              <button style={styles.newRoundBtn} onClick={() => setShowCourseSelect(true)}>+ New Round</button>
            </div>
            {rounds.length === 0 && (
              <div style={styles.emptyState}>
                <div style={styles.emptyIcon}>🏌️</div>
                <div style={styles.emptyText}>No rounds yet. Start tracking to build your handicap.</div>
              </div>
            )}
            {rounds.map(r => {
              const total = r.holes.reduce((s, h) => s + (h.score || h.par), 0);
              const par = r.holes.reduce((s, h) => s + h.par, 0);
              const diff = total - par;
              const isConfirming = confirmDeleteId === r.id;
              const isViewing = viewingRound?.id === r.id;
              return (
                <div key={r.id}>
                  <div style={{ ...styles.roundCard, ...(isViewing ? styles.roundCardActive : {}) }}
                    onClick={() => { if (!isConfirming) setViewingRound(isViewing ? null : r); }}>
                    <div style={{ flex: 1 }}>
                      <div style={styles.roundCourse}>{r.course?.name || "Unknown Course"}</div>
                      <div style={styles.roundDate}>{r.date}</div>
                    </div>
                    <div style={styles.roundCardRight}>
                      <div style={styles.roundScore}>{total}</div>
                      <div style={{ ...styles.roundDiff, color: diff > 0 ? "#e05c4b" : diff < 0 ? "#4caf80" : "#aaa" }}>
                        {diff > 0 ? `+${diff}` : diff === 0 ? "E" : diff}
                      </div>
                    </div>
                    <div style={styles.deleteWrap}>
                      {isConfirming ? (
                        <div style={styles.confirmRow}>
                          <button style={styles.confirmYes} onClick={e => { e.stopPropagation(); deleteRound(r.id); }}>Delete</button>
                          <button style={styles.confirmNo} onClick={e => { e.stopPropagation(); setConfirmDeleteId(null); }}>Cancel</button>
                        </div>
                      ) : (
                        <button style={styles.deleteBtn} onClick={e => { e.stopPropagation(); setConfirmDeleteId(r.id); }}>🗑</button>
                      )}
                    </div>
                  </div>
                  {isViewing && (
                    <div style={styles.roundDetail}>
                      <ScorecardView round={r} aiInsight={aiInsight} loading={loading} />
                    </div>
                  )}
                </div>
              );
            })}
            {view === "scorecard-view" && rounds[0] && !viewingRound && (
              <ScorecardView round={rounds[0]} aiInsight={aiInsight} loading={loading} />
            )}
          </div>
        )}

        {/* ACTIVE ROUND */}
        {view === "round" && activeRound && (
          <div>
            <div style={styles.roundHeader}>
              <div>
                <div style={styles.courseName}>{activeRound.course?.name}</div>
                <div style={styles.holeLabel}>Hole {activeHole + 1} · Par {activeRound.holes[activeHole].par}</div>
              </div>
              <div style={styles.liveScore}>
                <div style={styles.liveScoreNum}>{totalScore || "—"}</div>
                <div style={{ ...styles.liveScoreDiff, color: scoreDiff > 0 ? "#e05c4b" : scoreDiff < 0 ? "#4caf80" : "#aaa" }}>
                  {totalScore ? (scoreDiff > 0 ? `+${scoreDiff}` : scoreDiff === 0 ? "E" : scoreDiff) : ""}
                </div>
              </div>
            </div>

            {/* Mode Toggle */}
            <div style={styles.modeToggle}>
              <button style={{ ...styles.modeBtn, ...(trackMode === "classic" ? styles.modeBtnActive : {}) }} onClick={() => setTrackMode("classic")}>📋 Classic</button>
              <button style={{ ...styles.modeBtn, ...(trackMode === "map" ? styles.modeBtnActive : {}) }} onClick={() => setTrackMode("map")}>🗺️ Map</button>
            </div>

            <div style={styles.holeRow}>
              {activeRound.holes.map((h, i) => (
                <button key={i}
                  style={{ ...styles.holeBtn, ...(i === activeHole ? styles.holeBtnActive : {}), ...(h.shots.length > 0 || h.putts > 0 || h.notes ? styles.holeBtnDone : {}) }}
                  onClick={() => setActiveHole(i)}>
                  {i + 1}
                </button>
              ))}
            </div>

            {trackMode === "map" ? (
              <MapShotTracker
                hole={activeRound.holes[activeHole]}
                onUpdateHole={(updates) => {
                  const updated = JSON.parse(JSON.stringify(activeRound));
                  Object.assign(updated.holes[activeHole], updates);
                  setActiveRound(updated);
                }}
              />
            ) : (
              <>

            {/* Score Stepper */}
            {(() => {
              const hole = activeRound.holes[activeHole];
              const score = hole.score || hole.par;
              const diff = score - hole.par;
              const diffLabel = diff === 0 ? "E" : diff > 0 ? `+${diff}` : String(diff);
              const diffColor = diff < 0 ? "#4caf80" : diff > 0 ? "#e05c4b" : "#c8a96e";
              return (
                <div style={styles.stepperBlock}>
                  <div style={styles.stepperLabel}>Score</div>
                  <div style={styles.stepperRow}>
                    <button style={styles.stepperBtn} onClick={() => updateScore(activeHole, Math.max(1, score - 1))}>−</button>
                    <div style={styles.stepperCenter}>
                      <span style={{ ...styles.stepperValue, color: diffColor }}>{score}</span>
                      <span style={styles.stepperDiff}>{diffLabel}</span>
                    </div>
                    <button style={styles.stepperBtn} onClick={() => updateScore(activeHole, Math.min(12, score + 1))}>+</button>
                  </div>
                </div>
              );
            })()}

            {/* Putts Stepper */}
            {(() => {
              const putts = activeRound.holes[activeHole].putts || 0;
              return (
                <div style={styles.stepperBlock}>
                  <div style={styles.stepperLabel}>Putts</div>
                  <div style={styles.stepperRow}>
                    <button style={styles.stepperBtn} onClick={() => updatePutts(activeHole, Math.max(0, putts - 1))}>−</button>
                    <div style={styles.stepperCenter}>
                      <span style={{ ...styles.stepperValue, color: putts <= 2 ? "#4caf80" : putts >= 4 ? "#e05c4b" : "#fff" }}>{putts}</span>
                      <span style={styles.stepperDiff}>{putts === 1 ? "1 putt" : `${putts} putts`}</span>
                    </div>
                    <button style={styles.stepperBtn} onClick={() => updatePutts(activeHole, Math.min(6, putts + 1))}>+</button>
                  </div>
                </div>
              );
            })()}

            {/* Fairway Hit — only show on par 4s and 5s */}
            {activeRound.holes[activeHole].par >= 4 && (
              <div style={styles.fairwayBlock}>
                <span style={styles.stepperLabel}>Fairway Hit</span>
                <div style={styles.fairwayBtns}>
                  {[true, false].map(val => (
                    <button key={String(val)}
                      style={{ ...styles.fairwayBtn, ...(activeRound.holes[activeHole].fairwayHit === val ? (val ? styles.fairwayHit : styles.fairwayMiss) : {}) }}
                      onClick={() => updateFairway(activeHole, activeRound.holes[activeHole].fairwayHit === val ? null : val)}>
                      {val ? "✓ Hit" : "✗ Miss"}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Course Notes */}
            <div style={styles.notesBlock}>
              <div style={styles.stepperLabel}>Hole Notes</div>
              <textarea
                value={activeRound.holes[activeHole].notes || ""}
                onChange={e => updateNotes(activeHole, e.target.value)}
                placeholder="Pin position, club notes, wind…"
                style={styles.notesInput}
                rows={2}
              />
            </div>

            <div style={styles.shotsSection}>
              <div style={styles.shotsSectionHeader}>
                <span style={styles.shotsSectionTitle}>Shots ({activeRound.holes[activeHole].shots.length})</span>
                <button style={styles.addShotBtn} onClick={openShotModal}>+ Log Shot</button>
              </div>
              {activeRound.holes[activeHole].shots.map(s => {
                const isOpen = swipedShotId === s.id;
                return (
                  <div key={s.id} style={styles.shotRowWrap}>
                    <div style={{ ...styles.shotRow, ...(isOpen ? styles.shotRowOpen : {}) }}
                      onClick={() => setSwipedShotId(isOpen ? null : s.id)}>
                      <div style={{ ...styles.shotClubBadge, background: CLUBS.find(c => c.id === s.club)?.color || "#555" }}>
                        {CLUBS.find(c => c.id === s.club)?.abbr}
                      </div>
                      <div style={styles.shotInfo}>
                        <span style={styles.shotShape}>{s.shape}</span>
                        <span style={styles.shotResult}>{s.result}</span>
                        {s.distance && (
                          <span style={{ ...styles.shotDist, ...(s.gpsDistance ? styles.shotDistGps : {}) }}>
                            {s.distance}y{s.gpsDistance ? " 📡" : ""}
                          </span>
                        )}
                      </div>
                      <span style={styles.shotChevron}>{isOpen ? "✕" : "···"}</span>
                    </div>
                    {isOpen && (
                      <div style={styles.shotActions}>
                        <button style={styles.shotEditBtn} onClick={() => startEditShot(activeHole, s)}>✏️ Edit</button>
                        <button style={styles.shotDeleteBtn} onClick={() => deleteShot(activeHole, s.id)}>🗑 Delete</button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <div style={{ height: 80 }} />{/* spacer for sticky nav */}
              </>
            )}

            {/* Sticky Hole Nav — shows in both modes */}
            <div style={styles.holeNavSticky}>
              <button style={styles.holeNavBtn} disabled={activeHole === 0} onClick={() => setActiveHole(h => h - 1)}>← Prev</button>
              {activeHole < 17
                ? <button style={styles.holeNavBtnNext} onClick={() => setActiveHole(h => h + 1)}>Next Hole →</button>
                : <button style={{ ...styles.holeNavBtnNext, background: "#4caf80" }} onClick={finishRound}>Finish Round ✓</button>}
            </div>
          </div>
        )}

        {view === "stats" && <BagStats rounds={rounds} />}
        {view === "handicap" && <HandicapView rounds={rounds} handicapIndex={handicapIndex} />}
      </main>

      {/* Course Select Modal */}
      {showCourseSelect && (
        <div style={styles.modalOverlay} onClick={() => setShowCourseSelect(false)}>
          <div style={styles.modal} onClick={e => e.stopPropagation()}>
            <div style={styles.modalTitle}>Select Course</div>
            {SAMPLE_COURSES.map(c => (
              <button key={c.id} style={styles.courseItem} onClick={() => startRound(c)}>
                <div style={styles.courseItemName}>{c.name} <span style={{ color: "#6ab0de", fontSize: 12 }}>— {c.tee} Tee</span></div>
                <div style={styles.courseItemMeta}>
                  {c.location ? `${c.location} · ` : ""}{c.yards ? `${c.yards}y · ` : ""}Rating {c.rating} · Slope {c.slope} · Par {c.par}
                </div>
              </button>
            ))}
            <button style={styles.cancelBtn} onClick={() => setShowCourseSelect(false)}>Cancel</button>
          </div>
        </div>
      )}

      {/* Shot Log Modal */}
      {showShotModal && (
        <div style={styles.modalOverlay} onClick={() => setShowShotModal(false)}>
          <div style={styles.modal} onClick={e => e.stopPropagation()}>
            <div style={styles.modalTitle}>{editingShot ? "Edit Shot" : "Log Shot"}</div>

            <div style={styles.fieldLabel}>Club</div>
            <div style={styles.clubGrid}>
              {CLUBS.map(c => (
                <button key={c.id}
                  style={{ ...styles.clubChip, ...(pendingShot.club === c.id ? { background: c.color, color: "#fff" } : {}) }}
                  onClick={() => setPendingShot(p => ({ ...p, club: c.id }))}>
                  {c.abbr}
                </button>
              ))}
            </div>

            {/* Distance — GPS or Manual tabs */}
            <div style={styles.fieldLabel}>Distance</div>
            <div style={styles.tabRow}>
              <button style={{ ...styles.tab, ...(gpsTab === "gps" ? styles.tabActive : {}) }} onClick={() => setGpsTab("gps")}>📡 GPS</button>
              <button style={{ ...styles.tab, ...(gpsTab === "manual" ? styles.tabActive : {}) }} onClick={() => setGpsTab("manual")}>✏️ Manual</button>
            </div>

            {gpsTab === "gps" && (
              <GPSDistanceCapture
                onDistanceCaptured={(yards) => setPendingShot(p => ({ ...p, gpsDistance: yards, distance: String(yards) }))}
              />
            )}
            {gpsTab === "manual" && (
              <input type="number" style={styles.fieldInput} placeholder="e.g. 285 yards"
                value={pendingShot.distance}
                onChange={e => setPendingShot(p => ({ ...p, distance: e.target.value, gpsDistance: null }))} />
            )}

            <div style={styles.fieldLabel}>Result</div>
            <div style={styles.chipRow}>
              {SHOT_RESULTS.map(r => (
                <button key={r}
                  style={{ ...styles.chip, ...(pendingShot.result === r ? styles.chipActive : {}) }}
                  onClick={() => setPendingShot(p => ({ ...p, result: r }))}>{r}</button>
              ))}
            </div>

            <div style={styles.fieldLabel}>Shape</div>
            <div style={styles.chipRow}>
              {SHOT_SHAPES.map(s => (
                <button key={s}
                  style={{ ...styles.chip, ...(pendingShot.shape === s ? styles.chipActive : {}) }}
                  onClick={() => setPendingShot(p => ({ ...p, shape: s }))}>{s}</button>
              ))}
            </div>

            <div style={styles.modalActions}>
              <button style={styles.cancelBtn} onClick={() => setShowShotModal(false)}>Cancel</button>
              <button style={{ ...styles.confirmBtn, opacity: pendingShot.club ? 1 : 0.4 }}
                onClick={editingShot ? saveEditShot : addShot}>
                {editingShot ? "Save Changes" : "Add Shot"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ScorecardView({ round, aiInsight, loading }) {
  const front9 = round.holes.slice(0, 9);
  const back9 = round.holes.slice(9, 18);
  const frontScore = front9.reduce((s, h) => s + (h.score || h.par), 0);
  const backScore = back9.reduce((s, h) => s + (h.score || h.par), 0);
  const total = frontScore + backScore;
  const par = round.holes.reduce((s, h) => s + h.par, 0);

  const exportCSV = () => {
    const rows = [];

    // Header info
    rows.push(["CADDIE — Round Export"]);
    rows.push(["Course", round.course?.name || "Unknown"]);
    rows.push(["Tee", round.course?.tee || "—"]);
    rows.push(["Date", round.date]);
    rows.push(["Par", par]);
    rows.push(["Total Score", total]);
    rows.push(["Score vs Par", total - par > 0 ? `+${total - par}` : total - par === 0 ? "E" : String(total - par)]);
    rows.push(["Rating", round.course?.rating || "—"]);
    rows.push(["Slope", round.course?.slope || "—"]);
    rows.push([]);

    // Scorecard section
    rows.push(["--- SCORECARD ---"]);
    rows.push(["Hole", "Par", "Score", "Putts", "+/-"]);
    round.holes.forEach(h => {
      const score = h.score || h.par;
      const diff = score - h.par;
      rows.push([h.number, h.par, score, h.putts || 0, diff > 0 ? `+${diff}` : diff === 0 ? "E" : diff]);
    });
    rows.push(["TOTAL", par, total, round.holes.reduce((s, h) => s + (h.putts || 0), 0), total - par > 0 ? `+${total - par}` : total - par === 0 ? "E" : String(total - par)]);
    rows.push([]);

    // Shots section — merges Classic mode shots and Map mode marks
    rows.push(["--- SHOT LOG ---"]);
    rows.push(["Hole", "Shot #", "Club", "Distance (yds)", "GPS Measured", "Result", "Shape", "Mode", "Notes"]);
    round.holes.forEach(h => {
      const classicShots = (h.shots || []).map((s, i) => ({
        shotNum: i + 1,
        club: CLUBS.find(c => c.id === s.club)?.label || s.club,
        distance: s.distance || "—",
        gps: s.gpsDistance ? "Yes" : "No",
        result: s.result,
        shape: s.shape || "—",
        mode: "Classic",
        notes: s.notes || "",
      }));
      const mapShots = (h.mapMarks || []).map(m => ({
        shotNum: m.shotNum,
        club: CLUBS.find(c => c.id === m.club)?.label || m.club || "—",
        distance: m.distance || "—",
        gps: "Yes",
        result: m.lieType,
        shape: m.shape || "—",
        mode: "Map",
        notes: "",
      }));
      const allShots = [...classicShots, ...mapShots];

      if (allShots.length === 0) {
        rows.push([h.number, "—", "—", "—", "—", "—", "—", "—", "—"]);
      } else {
        allShots.forEach(s => {
          rows.push([h.number, s.shotNum, s.club, s.distance, s.gps, s.result, s.shape, s.mode, s.notes]);
        });
      }
    });

    // Convert to CSV string
    const csv = rows.map(r => r.map(cell => {
      const val = String(cell ?? "");
      return val.includes(",") || val.includes('"') || val.includes("\n")
        ? `"${val.replace(/"/g, '""')}"` : val;
    }).join(",")).join("\n");

    // Trigger download
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `caddie_${(round.course?.name || "round").replace(/\s+/g, "_")}_${round.date}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{ marginTop: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={styles.sectionTitle} >Scorecard</div>
        <button style={styles.exportBtn} onClick={exportCSV}>⬇ Export CSV</button>
      </div>
      <div style={styles.scorecard}>
        <div style={styles.scorecardRow}>
          <div style={styles.scHole}>Hole</div>
          {front9.map(h => <div key={h.number} style={styles.scCell}>{h.number}</div>)}
          <div style={styles.scOut}>Out</div>
        </div>
        <div style={styles.scorecardRow}>
          <div style={styles.scHole}>Par</div>
          {front9.map(h => <div key={h.number} style={styles.scCell}>{h.par}</div>)}
          <div style={styles.scOut}>{front9.reduce((s, h) => s + h.par, 0)}</div>
        </div>
        <div style={{ ...styles.scorecardRow, background: "#1a2030" }}>
          <div style={styles.scHole}>Score</div>
          {front9.map(h => {
            const diff = (h.score || h.par) - h.par;
            return <div key={h.number} style={{ ...styles.scCell, color: diff < 0 ? "#4caf80" : diff > 1 ? "#e05c4b" : diff === 1 ? "#f5a623" : "#fff", fontWeight: 700 }}>{h.score || "—"}</div>;
          })}
          <div style={{ ...styles.scOut, fontWeight: 700 }}>{frontScore}</div>
        </div>
        <div style={styles.scorecardRow}>
          <div style={styles.scHole}>Hole</div>
          {back9.map(h => <div key={h.number} style={styles.scCell}>{h.number}</div>)}
          <div style={styles.scOut}>In</div>
        </div>
        <div style={styles.scorecardRow}>
          <div style={styles.scHole}>Par</div>
          {back9.map(h => <div key={h.number} style={styles.scCell}>{h.par}</div>)}
          <div style={styles.scOut}>{back9.reduce((s, h) => s + h.par, 0)}</div>
        </div>
        <div style={{ ...styles.scorecardRow, background: "#1a2030" }}>
          <div style={styles.scHole}>Score</div>
          {back9.map(h => {
            const diff = (h.score || h.par) - h.par;
            return <div key={h.number} style={{ ...styles.scCell, color: diff < 0 ? "#4caf80" : diff > 1 ? "#e05c4b" : diff === 1 ? "#f5a623" : "#fff", fontWeight: 700 }}>{h.score || "—"}</div>;
          })}
          <div style={{ ...styles.scOut, fontWeight: 700 }}>{backScore}</div>
        </div>
        <div style={{ ...styles.scorecardRow, background: "#0e1520", borderTop: "2px solid #c8a96e" }}>
          <div style={{ ...styles.scHole, color: "#c8a96e" }}>Total</div>
          <div style={{ gridColumn: "span 9", textAlign: "center", fontSize: 22, fontWeight: 800, color: "#fff", padding: "8px 0" }}>{total}</div>
          <div style={{ ...styles.scOut, color: "#c8a96e", fontSize: 18 }}>{total - par > 0 ? `+${total - par}` : total - par === 0 ? "E" : total - par}</div>
        </div>
      </div>

      {/* Strokes Gained + Driving Accuracy */}
      <StatsPanel round={round} />

      {/* MyGSGA Post Score */}
      <div style={styles.ghinBtn} onClick={() => {
        // Try to open MyGSGA app, fall back to GSGA score posting page
        const webUrl = "https://host.gsga.org/handicapping/post-a-score/";
        const appUrl = "mygsga://postscore";
        const fallback = setTimeout(() => { window.open(webUrl, "_blank"); }, 600);
        const iframe = document.createElement("iframe");
        iframe.style.display = "none";
        iframe.src = appUrl;
        document.body.appendChild(iframe);
        setTimeout(() => { document.body.removeChild(iframe); clearTimeout(fallback); }, 2000);
        try { window.location = appUrl; } catch(e) {}
      }}>
        <span style={styles.ghinLogo}>GSGA</span>
        <div style={{ flex: 1 }}>
          <div style={styles.ghinBtnText}>Post Score to MyGSGA</div>
          <div style={styles.ghinBtnSub}>Opens MyGSGA app · falls back to gsga.org</div>
        </div>
        <span style={styles.ghinArrow}>↗</span>
      </div>

      <div style={styles.insightBox}>
        <div style={styles.insightHeader}>🤖 Coach Insight</div>
        {loading ? <div style={styles.insightLoading}>Analyzing your round…</div>
          : aiInsight ? <div style={styles.insightText}>{aiInsight}</div>
          : <div style={styles.insightText}>Complete a round to get AI coaching feedback.</div>}
      </div>
    </div>
  );
}

// PGA Tour averages for SG baseline (strokes to hole out from given situation)
// Simplified model: baseline expected strokes from tee/approach/around green
const SG_BASELINE = {
  // Expected strokes from tee on par 4s/5s (tour avg)
  tee: { 4: 3.99, 5: 4.68 },
  // Expected putts from distance bands
  putts: { 0: 1.0, 3: 1.083, 5: 1.25, 10: 1.5, 15: 1.75, 20: 1.9, 30: 2.0, 40: 2.1, 60: 2.2 },
};

function getPuttBaseline(feet) {
  const keys = Object.keys(SG_BASELINE.putts).map(Number).sort((a,b)=>a-b);
  for (let i = keys.length - 1; i >= 0; i--) {
    if (feet >= keys[i]) return SG_BASELINE.putts[keys[i]];
  }
  return 1.0;
}

function StatsPanel({ round }) {
  const totalPar = round.holes.reduce((s, h) => s + h.par, 0);
  const totalScore = round.holes.reduce((s, h) => s + (h.score || h.par), 0);
  const totalPutts = round.holes.reduce((s, h) => s + (h.putts || 0), 0);

  // Driving accuracy (par 4 + par 5 fairways only)
  const drivingHoles = round.holes.filter(h => h.par >= 4 && h.fairwayHit !== null);
  const fairwaysHit = drivingHoles.filter(h => h.fairwayHit === true).length;
  const drivingAcc = drivingHoles.length > 0 ? Math.round((fairwaysHit / drivingHoles.length) * 100) : null;

  // GIR — approximate from shot results: last non-putt shot result = Green
  const girHoles = round.holes.filter(h => {
    const merged = [
      ...(h.shots || []).map(s => ({ club: s.club, result: s.result })),
      ...(h.mapMarks || []).map(m => ({ club: m.club, result: m.lieType })),
    ];
    const nonPutt = merged.filter(s => s.club !== "putter");
    return nonPutt.length > 0 && nonPutt[nonPutt.length - 1].result === "Green";
  });
  const girPct = round.holes.some(h => (h.shots?.length > 0) || (h.mapMarks?.length > 0))
    ? Math.round((girHoles.length / round.holes.length) * 100) : null;

  // Strokes Gained: Putting (vs 2-putt baseline on every hole)
  const sgPutting = round.holes.reduce((sum, h) => {
    if (!h.putts) return sum;
    // baseline = 2 putts per hole (simplified; real SG:P uses distance)
    return sum + (2 - h.putts);
  }, 0);

  // Strokes Gained: Tee-to-Green (score minus putts vs par minus 2)
  const sgTeeToGreen = round.holes.reduce((sum, h) => {
    const score = h.score || h.par;
    const putts = h.putts || 0;
    const expectedTeeToGreen = h.par - 2; // par minus 2 putts
    const actualTeeToGreen = score - putts;
    return sum + (expectedTeeToGreen - actualTeeToGreen);
  }, 0);

  const sgTotal = sgPutting + sgTeeToGreen;

  const StatRow = ({ label, value, suffix = "", color, sub }) => (
    <div style={sgStyles.statRow}>
      <div>
        <div style={sgStyles.statLabel}>{label}</div>
        {sub && <div style={sgStyles.statSub}>{sub}</div>}
      </div>
      <div style={{ ...sgStyles.statValue, color: color || "#fff" }}>
        {value !== null ? `${value > 0 ? "+" : ""}${typeof value === "number" ? value.toFixed(1) : value}${suffix}` : "—"}
      </div>
    </div>
  );

  return (
    <div style={sgStyles.wrap}>
      <div style={sgStyles.title}>Round Analytics</div>

      <div style={sgStyles.section}>
        <div style={sgStyles.sectionLabel}>Strokes Gained</div>
        <StatRow label="SG: Total" value={sgTotal} color={sgTotal >= 0 ? "#4caf80" : "#e05c4b"} sub="vs. scratch baseline" />
        <StatRow label="SG: Putting" value={sgPutting} color={sgPutting >= 0 ? "#4caf80" : "#e05c4b"} sub="vs. 2-putt avg" />
        <StatRow label="SG: Tee-to-Green" value={sgTeeToGreen} color={sgTeeToGreen >= 0 ? "#4caf80" : "#e05c4b"} sub="score excl. putts vs par-2" />
      </div>

      <div style={sgStyles.divider} />

      <div style={sgStyles.section}>
        <div style={sgStyles.sectionLabel}>Accuracy</div>
        <div style={sgStyles.statRow}>
          <div>
            <div style={sgStyles.statLabel}>Driving Accuracy</div>
            <div style={sgStyles.statSub}>{drivingHoles.length > 0 ? `${fairwaysHit}/${drivingHoles.length} fairways` : "Log fairway hit/miss to track"}</div>
          </div>
          <div style={{ ...sgStyles.statValue, color: drivingAcc >= 60 ? "#4caf80" : drivingAcc !== null ? "#f5a623" : "#555" }}>
            {drivingAcc !== null ? `${drivingAcc}%` : "—"}
          </div>
        </div>
        <div style={sgStyles.statRow}>
          <div>
            <div style={sgStyles.statLabel}>Greens in Regulation</div>
            <div style={sgStyles.statSub}>{girHoles.length}/18 holes</div>
          </div>
          <div style={{ ...sgStyles.statValue, color: girPct >= 50 ? "#4caf80" : girPct !== null ? "#f5a623" : "#555" }}>
            {girPct !== null ? `${girPct}%` : "—"}
          </div>
        </div>
        <div style={sgStyles.statRow}>
          <div>
            <div style={sgStyles.statLabel}>Total Putts</div>
            <div style={sgStyles.statSub}>avg {totalPutts > 0 ? (totalPutts / 18).toFixed(1) : "—"} per hole</div>
          </div>
          <div style={{ ...sgStyles.statValue, color: totalPutts > 0 && totalPutts <= 30 ? "#4caf80" : totalPutts > 36 ? "#e05c4b" : "#fff" }}>
            {totalPutts || "—"}
          </div>
        </div>
      </div>
    </div>
  );
}

const sgStyles = {
  wrap: { background: "#0e1520", border: "1px solid #1e2a3a", borderRadius: 12, padding: "16px", marginBottom: 10 },
  title: { fontSize: 11, letterSpacing: 3, color: "#c8a96e", textTransform: "uppercase", marginBottom: 14 },
  section: { display: "flex", flexDirection: "column", gap: 10 },
  sectionLabel: { fontSize: 10, letterSpacing: 2, color: "#555", textTransform: "uppercase", marginBottom: 4 },
  statRow: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  statLabel: { fontSize: 13, color: "#e8e0d0" },
  statSub: { fontSize: 11, color: "#555", marginTop: 1 },
  statValue: { fontSize: 20, fontWeight: 800, minWidth: 60, textAlign: "right" },
  divider: { borderTop: "1px solid #1e2a3a", margin: "14px 0" },
};

function BagStats({ rounds }) {
  const allShots = rounds.flatMap(r => r.holes.flatMap(h => [
    ...(h.shots || []),
    ...(h.mapMarks || []).map(m => ({ club: m.club, distance: m.distance, gpsDistance: m.distance, result: m.lieType })),
  ])).filter(s => s.club);
  const byClub = {};
  allShots.forEach(s => {
    if (!byClub[s.club]) byClub[s.club] = { count: 0, distances: [], gpsDistances: [], results: {} };
    byClub[s.club].count++;
    if (s.distance) byClub[s.club].distances.push(parseInt(s.distance));
    if (s.gpsDistance) byClub[s.club].gpsDistances.push(s.gpsDistance);
    byClub[s.club].results[s.result] = (byClub[s.club].results[s.result] || 0) + 1;
  });

  if (Object.keys(byClub).length === 0) return (
    <div style={styles.emptyState}>
      <div style={styles.emptyIcon}>🏌️</div>
      <div style={styles.emptyText}>Log shots during a round to see your bag stats.</div>
    </div>
  );

  return (
    <div>
      <div style={styles.sectionTitle}>My Bag</div>
      {CLUBS.filter(c => byClub[c.id]).map(c => {
        const data = byClub[c.id];
        const avgGps = data.gpsDistances.length > 0
          ? Math.round(data.gpsDistances.reduce((s, d) => s + d, 0) / data.gpsDistances.length) : null;
        const avgAll = data.distances.length > 0
          ? Math.round(data.distances.reduce((s, d) => s + d, 0) / data.distances.length) : null;
        const fairways = (data.results["Fairway"] || 0) + (data.results["Green"] || 0);
        const acc = data.count > 0 ? Math.round((fairways / data.count) * 100) : 0;
        return (
          <div key={c.id} style={styles.bagCard}>
            <div style={{ ...styles.bagClubDot, background: c.color }} />
            <div style={styles.bagInfo}>
              <div style={styles.bagClubName}>{c.label}</div>
              <div style={styles.bagMeta}>
                {data.count} shots
                {avgGps ? <span style={{ color: "#c8a96e" }}> · 📡 {avgGps}y</span> : avgAll ? ` · ${avgAll}y avg` : ""}
              </div>
            </div>
            <div style={styles.bagAccuracy}>
              <div style={styles.bagAccNum}>{acc}%</div>
              <div style={styles.bagAccLabel}>On target</div>
            </div>
          </div>
        );
      })}
      <div style={{ fontSize: 11, color: "#555", marginTop: 12, textAlign: "center" }}>📡 = GPS-measured average</div>
    </div>
  );
}

function HandicapView({ rounds, handicapIndex }) {
  const completed = rounds.filter(r => r.completed && r.course);
  const diffs = completed.map(r => {
    const total = r.holes.reduce((s, h) => s + (h.score || h.par), 0);
    return { date: r.date, course: r.course.name, score: total, diff: ((total - r.course.rating) * 113 / r.course.slope).toFixed(1) };
  });

  return (
    <div>
      <div style={styles.hcapHero}>
        <div style={styles.hcapHeroLabel}>USGA Handicap Index</div>
        <div style={styles.hcapHeroValue}>{handicapIndex !== null ? handicapIndex.toFixed(1) : "—"}</div>
        <div style={styles.hcapHeroSub}>
          {completed.length < 3 ? `${completed.length}/3 rounds needed for index`
            : `Best ${Math.min(Math.floor(completed.length * 0.4) + 1, 8)} of ${diffs.length} differentials`}
        </div>
      </div>
      <div style={styles.usga}>
        <div style={styles.usgaHeader}>
          <div style={styles.usgaLogo}>USGA</div>
          <div style={styles.usgaText}>World Handicap System</div>
        </div>
        <div style={styles.usgaBody}>Handicap calculated per USGA WHS using Course Rating, Slope Rating, and best differentials from posted scores.</div>
      </div>
      {diffs.length > 0 && (
        <div>
          <div style={styles.sectionTitle}>Score History</div>
          {diffs.map((d, i) => (
            <div key={i} style={styles.diffRow}>
              <div>
                <div style={styles.diffCourse}>{d.course}</div>
                <div style={styles.diffDate}>{d.date}</div>
              </div>
              <div style={styles.diffRight}>
                <div style={styles.diffScore}>{d.score}</div>
                <div style={styles.diffVal}>{d.diff}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const styles = {
  app: { background: "#0a0f1a", minHeight: "100vh", color: "#e8e0d0", fontFamily: "'Georgia', 'Times New Roman', serif", maxWidth: 480, margin: "0 auto" },
  header: { background: "linear-gradient(135deg, #0e1520 0%, #141d2e 100%)", borderBottom: "1px solid #c8a96e33", padding: "16px 20px", display: "flex", alignItems: "center", justifyContent: "space-between" },
  headerLeft: { display: "flex", alignItems: "center", gap: 12 },
  logo: { fontSize: 28 },
  logoText: { fontSize: 22, fontWeight: 800, letterSpacing: 4, color: "#c8a96e", fontFamily: "Georgia, serif" },
  logoSub: { fontSize: 10, color: "#888", letterSpacing: 2, textTransform: "uppercase" },
  hcapBadge: { background: "#c8a96e", borderRadius: 8, padding: "6px 12px", textAlign: "center" },
  hcapLabel: { fontSize: 9, color: "#5a3a10", letterSpacing: 2, fontWeight: 700 },
  hcapValue: { fontSize: 20, fontWeight: 800, color: "#2a1a05" },
  nav: { background: "#0e1520", display: "flex", borderBottom: "1px solid #1e2a3a" },
  navBtn: { flex: 1, padding: "12px 0", background: "none", border: "none", color: "#666", fontSize: 13, letterSpacing: 1, cursor: "pointer", fontFamily: "Georgia, serif" },
  navBtnActive: { color: "#c8a96e", borderBottom: "2px solid #c8a96e" },
  main: { padding: "20px 16px", minHeight: "calc(100vh - 110px)" },
  sectionHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
  sectionTitle: { fontSize: 13, letterSpacing: 3, textTransform: "uppercase", color: "#c8a96e", marginBottom: 12 },
  newRoundBtn: { background: "#c8a96e", border: "none", borderRadius: 6, padding: "8px 14px", color: "#1a0f05", fontSize: 13, fontWeight: 700, cursor: "pointer" },
  emptyState: { textAlign: "center", padding: "60px 20px" },
  emptyIcon: { fontSize: 48, marginBottom: 16 },
  emptyText: { color: "#666", fontSize: 14, lineHeight: 1.6 },
  roundCard: { background: "#0e1520", border: "1px solid #1e2a3a", borderRadius: 10, padding: "14px 16px", marginBottom: 10, display: "flex", justifyContent: "space-between", alignItems: "center" },
  roundCourse: { fontSize: 15, fontWeight: 600, color: "#e8e0d0" },
  roundDate: { fontSize: 12, color: "#666", marginTop: 2 },
  roundCardRight: { textAlign: "right", marginLeft: 8 },
  deleteWrap: { marginLeft: 10, display: "flex", alignItems: "center" },
  deleteBtn: { background: "none", border: "none", fontSize: 16, cursor: "pointer", opacity: 0.45, padding: "4px 6px" },
  confirmRow: { display: "flex", flexDirection: "column", gap: 4 },
  confirmYes: { background: "#e05c4b", border: "none", borderRadius: 5, padding: "4px 10px", color: "#fff", fontSize: 11, fontWeight: 700, cursor: "pointer" },
  confirmNo: { background: "#1a2030", border: "1px solid #2a3545", borderRadius: 5, padding: "4px 10px", color: "#888", fontSize: 11, cursor: "pointer" },
  roundScore: { fontSize: 24, fontWeight: 800, color: "#fff" },
  roundDiff: { fontSize: 13, fontWeight: 600 },
  roundHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, background: "#0e1520", borderRadius: 10, padding: "12px 16px" },
  courseName: { fontSize: 15, fontWeight: 600, color: "#c8a96e" },
  holeLabel: { fontSize: 13, color: "#888", marginTop: 2 },
  liveScore: { textAlign: "right" },
  liveScoreNum: { fontSize: 32, fontWeight: 800, color: "#fff" },
  liveScoreDiff: { fontSize: 14, fontWeight: 600 },
  holeRow: { display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 16 },
  modeToggle: { display: "flex", gap: 8, marginBottom: 14 },
  modeBtn: { flex: 1, padding: "10px 0", background: "#0e1520", border: "1px solid #1e2a3a", borderRadius: 8, color: "#666", fontSize: 13, cursor: "pointer", fontFamily: "Georgia, serif" },
  modeBtnActive: { background: "#1a2a1a", border: "1px solid #4caf8077", color: "#4caf80", fontWeight: 600 },
  holeBtn: { width: 36, height: 36, borderRadius: 6, background: "#1a2030", border: "1px solid #2a3545", color: "#888", fontSize: 12, cursor: "pointer" },
  holeBtnActive: { background: "#c8a96e", color: "#1a0f05", fontWeight: 700, border: "1px solid #c8a96e" },
  holeBtnDone: { border: "1px solid #4caf8066", color: "#4caf80" },
  scoreRow: { display: "flex", gap: 12, marginBottom: 20 },
  scoreBlock: { flex: 1, background: "#0e1520", borderRadius: 10, padding: "12px 16px", border: "1px solid #1e2a3a" },
  scoreBlockLabel: { fontSize: 11, letterSpacing: 2, color: "#888", marginBottom: 6 },
  scoreInput: { width: "100%", background: "none", border: "none", fontSize: 32, fontWeight: 800, color: "#fff", outline: "none", fontFamily: "Georgia, serif" },
  shotsSection: {},
  shotsSectionHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  shotsSectionTitle: { fontSize: 12, letterSpacing: 2, color: "#888", textTransform: "uppercase" },
  addShotBtn: { background: "none", border: "1px solid #c8a96e", color: "#c8a96e", borderRadius: 6, padding: "6px 12px", fontSize: 12, cursor: "pointer" },
  shotRow: { display: "flex", alignItems: "center", gap: 10, background: "#0e1520", borderRadius: 8, padding: "10px 12px", marginBottom: 6 },
  shotClubBadge: { width: 34, height: 34, borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: "#fff", flexShrink: 0 },
  shotInfo: { display: "flex", gap: 8, fontSize: 13, alignItems: "center" },
  shotShape: { color: "#e8e0d0" },
  shotResult: { color: "#888" },
  shotDist: { color: "#c8a96e", fontWeight: 600 },
  shotDistGps: { color: "#4caf80" },
  holeNav: { display: "flex", gap: 10, marginTop: 24 },
  holeNavSticky: { position: "sticky", bottom: 0, display: "flex", gap: 10, padding: "12px 0 8px", background: "linear-gradient(to bottom, transparent, #0a0f1a 30%)", zIndex: 10, marginBottom: 4 },
  roundCardActive: { borderColor: "#c8a96e55", background: "#111820" },
  roundDetail: { marginBottom: 8 },
  stepperBlock: { background: "#0e1520", borderRadius: 12, padding: "14px 16px", border: "1px solid #1e2a3a", marginBottom: 10 },
  stepperLabel: { fontSize: 11, letterSpacing: 2, color: "#888", textTransform: "uppercase", marginBottom: 10 },
  stepperRow: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 },
  stepperBtn: { width: 64, height: 64, borderRadius: 12, background: "#1a2030", border: "1px solid #2a3545", color: "#e8e0d0", fontSize: 32, fontWeight: 300, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 },
  stepperCenter: { flex: 1, display: "flex", flexDirection: "column", alignItems: "center" },
  stepperValue: { fontSize: 48, fontWeight: 800, lineHeight: 1 },
  stepperDiff: { fontSize: 13, color: "#666", marginTop: 2 },
  shotRowWrap: { marginBottom: 6 },
  shotRowOpen: { borderRadius: "8px 8px 0 0", borderColor: "#c8a96e55" },
  shotActions: { display: "flex", borderRadius: "0 0 8px 8px", overflow: "hidden", border: "1px solid #c8a96e33", borderTop: "none" },
  shotEditBtn: { flex: 1, padding: "10px 0", background: "#1a2a3a", border: "none", color: "#c8a96e", fontSize: 13, cursor: "pointer", fontFamily: "Georgia, serif" },
  shotDeleteBtn: { flex: 1, padding: "10px 0", background: "#2a1a1a", border: "none", borderLeft: "1px solid #c8a96e33", color: "#e05c4b", fontSize: 13, cursor: "pointer", fontFamily: "Georgia, serif" },
  shotChevron: { color: "#555", fontSize: 14, marginLeft: 8 },
  fairwayBlock: { display: "flex", justifyContent: "space-between", alignItems: "center", background: "#0e1520", borderRadius: 10, padding: "12px 16px", border: "1px solid #1e2a3a", marginBottom: 10 },
  fairwayBtns: { display: "flex", gap: 8 },
  fairwayBtn: { padding: "6px 16px", background: "#1a2030", border: "1px solid #2a3545", borderRadius: 20, color: "#666", fontSize: 13, cursor: "pointer" },
  fairwayHit: { background: "#1a3a2a", border: "1px solid #4caf80", color: "#4caf80" },
  fairwayMiss: { background: "#3a1a1a", border: "1px solid #e05c4b", color: "#e05c4b" },
  notesBlock: { background: "#0e1520", borderRadius: 10, padding: "12px 16px", border: "1px solid #1e2a3a", marginBottom: 12 },
  notesInput: { width: "100%", background: "#141d2e", border: "1px solid #2a3545", borderRadius: 8, padding: "8px 10px", color: "#e8e0d0", fontSize: 13, fontFamily: "Georgia, serif", resize: "none", marginTop: 8, boxSizing: "border-box" },
  holeNavBtn: { flex: 1, padding: "12px 0", background: "#1a2030", border: "1px solid #2a3545", color: "#888", borderRadius: 8, cursor: "pointer", fontSize: 14 },
  holeNavBtnNext: { flex: 2, padding: "12px 0", background: "#c8a96e", border: "none", color: "#1a0f05", borderRadius: 8, cursor: "pointer", fontSize: 14, fontWeight: 700 },
  modalOverlay: { position: "fixed", inset: 0, background: "#000000cc", display: "flex", alignItems: "flex-end", zIndex: 100 },
  modal: { background: "#0e1520", borderRadius: "16px 16px 0 0", padding: "24px 20px", width: "100%", maxWidth: 480, margin: "0 auto", maxHeight: "88vh", overflowY: "auto" },
  modalTitle: { fontSize: 18, fontWeight: 700, color: "#c8a96e", marginBottom: 18, letterSpacing: 1 },
  courseItem: { display: "block", width: "100%", background: "#141d2e", border: "1px solid #2a3545", borderRadius: 8, padding: "12px 14px", marginBottom: 8, textAlign: "left", cursor: "pointer" },
  courseItemName: { fontSize: 14, fontWeight: 600, color: "#e8e0d0" },
  courseItemMeta: { fontSize: 12, color: "#666", marginTop: 2 },
  fieldLabel: { fontSize: 11, letterSpacing: 2, color: "#888", textTransform: "uppercase", marginBottom: 8, marginTop: 16 },
  fieldInput: { width: "100%", background: "#141d2e", border: "1px solid #2a3545", borderRadius: 8, padding: "10px 12px", color: "#e8e0d0", fontSize: 16, fontFamily: "Georgia, serif", boxSizing: "border-box" },
  tabRow: { display: "flex", gap: 6, marginBottom: 8 },
  tab: { flex: 1, padding: "8px 0", background: "#141d2e", border: "1px solid #2a3545", borderRadius: 8, color: "#666", fontSize: 13, cursor: "pointer" },
  tabActive: { background: "#1a2a3a", border: "1px solid #c8a96e", color: "#c8a96e" },
  clubGrid: { display: "flex", flexWrap: "wrap", gap: 6 },
  clubChip: { padding: "6px 10px", background: "#1a2030", border: "1px solid #2a3545", borderRadius: 6, color: "#aaa", fontSize: 12, cursor: "pointer", fontWeight: 600 },
  chipRow: { display: "flex", flexWrap: "wrap", gap: 6 },
  chip: { padding: "6px 12px", background: "#1a2030", border: "1px solid #2a3545", borderRadius: 20, color: "#aaa", fontSize: 12, cursor: "pointer" },
  chipActive: { background: "#c8a96e22", border: "1px solid #c8a96e", color: "#c8a96e" },
  modalActions: { display: "flex", gap: 10, marginTop: 24 },
  cancelBtn: { flex: 1, padding: "12px 0", background: "#1a2030", border: "1px solid #2a3545", color: "#888", borderRadius: 8, cursor: "pointer", fontSize: 14 },
  confirmBtn: { flex: 2, padding: "12px 0", background: "#c8a96e", border: "none", color: "#1a0f05", borderRadius: 8, cursor: "pointer", fontSize: 14, fontWeight: 700 },
  scorecard: { background: "#0e1520", borderRadius: 10, overflow: "hidden", border: "1px solid #1e2a3a", marginBottom: 20 },
  scorecardRow: { display: "grid", gridTemplateColumns: "40px repeat(9, 1fr) 44px", borderBottom: "1px solid #1a2030" },
  scHole: { padding: "6px 4px", fontSize: 10, color: "#888", textAlign: "center", display: "flex", alignItems: "center", justifyContent: "center", borderRight: "1px solid #1a2030" },
  scCell: { padding: "6px 2px", fontSize: 12, color: "#ccc", textAlign: "center", display: "flex", alignItems: "center", justifyContent: "center" },
  scOut: { padding: "6px 4px", fontSize: 12, color: "#c8a96e", textAlign: "center", display: "flex", alignItems: "center", justifyContent: "center", borderLeft: "1px solid #2a3545", fontWeight: 700 },
  insightBox: { background: "linear-gradient(135deg, #0e1520, #141d2e)", border: "1px solid #c8a96e44", borderRadius: 12, padding: 18, marginTop: 8 },
  ghinBtn: { display: "flex", alignItems: "center", gap: 10, background: "#002868", border: "1px solid #003fa0", borderRadius: 10, padding: "14px 16px", marginBottom: 10, cursor: "pointer" },
  ghinLogo: { background: "#fff", color: "#002868", fontWeight: 900, fontSize: 11, padding: "2px 7px", borderRadius: 4, letterSpacing: 1, flexShrink: 0 },
  ghinBtnText: { color: "#fff", fontSize: 14, fontWeight: 600 },
  ghinBtnSub: { color: "#6ab0de", fontSize: 11, marginTop: 2 },
  ghinArrow: { color: "#6ab0de", fontSize: 16 },
  exportBtn: { background: "none", border: "1px solid #4caf80", color: "#4caf80", borderRadius: 6, padding: "6px 12px", fontSize: 12, cursor: "pointer", letterSpacing: 0.5 },
  insightHeader: { fontSize: 13, color: "#c8a96e", letterSpacing: 1, marginBottom: 12, fontWeight: 700 },
  insightLoading: { color: "#666", fontSize: 13, fontStyle: "italic" },
  insightText: { fontSize: 13, color: "#aaa", lineHeight: 1.8, whiteSpace: "pre-wrap" },
  bagCard: { display: "flex", alignItems: "center", gap: 12, background: "#0e1520", borderRadius: 10, padding: "12px 14px", marginBottom: 8, border: "1px solid #1e2a3a" },
  bagClubDot: { width: 12, height: 12, borderRadius: "50%", flexShrink: 0 },
  bagInfo: { flex: 1 },
  bagClubName: { fontSize: 14, fontWeight: 600, color: "#e8e0d0" },
  bagMeta: { fontSize: 12, color: "#666", marginTop: 2 },
  bagAccuracy: { textAlign: "right" },
  bagAccNum: { fontSize: 20, fontWeight: 800, color: "#4caf80" },
  bagAccLabel: { fontSize: 10, color: "#666" },
  hcapHero: { background: "linear-gradient(135deg, #0e1520 0%, #1a1400 100%)", border: "1px solid #c8a96e44", borderRadius: 14, padding: "28px 20px", textAlign: "center", marginBottom: 20 },
  hcapHeroLabel: { fontSize: 11, letterSpacing: 3, color: "#888", textTransform: "uppercase", marginBottom: 8 },
  hcapHeroValue: { fontSize: 64, fontWeight: 800, color: "#c8a96e", lineHeight: 1 },
  hcapHeroSub: { fontSize: 12, color: "#666", marginTop: 10 },
  usga: { background: "#0e1520", border: "1px solid #1e2a3a", borderRadius: 10, padding: "14px 16px", marginBottom: 24 },
  usgaHeader: { display: "flex", alignItems: "center", gap: 10, marginBottom: 8 },
  usgaLogo: { background: "#002868", color: "#fff", fontWeight: 900, fontSize: 12, padding: "3px 8px", borderRadius: 4, letterSpacing: 1 },
  usgaText: { fontSize: 12, color: "#888", letterSpacing: 1 },
  usgaBody: { fontSize: 12, color: "#666", lineHeight: 1.6 },
  diffRow: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 14px", background: "#0e1520", borderRadius: 8, marginBottom: 6, border: "1px solid #1a2030" },
  diffCourse: { fontSize: 13, color: "#e8e0d0" },
  diffDate: { fontSize: 11, color: "#666", marginTop: 2 },
  diffRight: { textAlign: "right" },
  diffScore: { fontSize: 18, fontWeight: 700, color: "#fff" },
  diffVal: { fontSize: 12, color: "#c8a96e" },
};
