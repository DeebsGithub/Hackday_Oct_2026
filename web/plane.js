// Procedural toy airplanes hung like keychain charms. Needs the global THREE (r128).

(function () {
  const CHARCOAL = 0x1e1e1e;

  // Hex values are sRGB; r128 materials expect linear
  const lin = (hex) => new THREE.Color(hex).convertSRGBToLinear();

  function glossy(color) {
    return new THREE.MeshPhysicalMaterial({
      color: lin(color), roughness: 0.3, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 0.7,
    });
  }

  function chrome() {
    return new THREE.MeshStandardMaterial({ color: 0xdedede, metalness: 1, roughness: 0.18 });
  }

  // Extruded flat part (wing, stabilizer, fin) with soft bevelled edges
  function slab(shape, depth) {
    const g = new THREE.ExtrudeGeometry(shape, {
      depth, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 5, curveSegments: 16,
    });
    g.translate(0, 0, -depth / 2);
    return g;
  }

  function wingShape(s) {
    const sh = new THREE.Shape();
    sh.moveTo(0.75, 0);
    sh.lineTo(-0.3, 2.2 * s);
    sh.quadraticCurveTo(-0.5, 2.45 * s, -0.82, 2.3 * s);
    sh.lineTo(-0.5, 0);
    sh.lineTo(0.75, 0);
    return sh;
  }

  function stabShape(s) {
    const sh = new THREE.Shape();
    sh.moveTo(-1.55, 0);
    sh.lineTo(-2.0, 0.9 * s);
    sh.quadraticCurveTo(-2.12, 1.04 * s, -2.32, 0.92 * s);
    sh.lineTo(-2.22, 0);
    sh.lineTo(-1.55, 0);
    return sh;
  }

  function finShape() {
    const sh = new THREE.Shape();
    sh.moveTo(-1.3, 0.3);
    sh.lineTo(-1.95, 1.4);
    sh.quadraticCurveTo(-2.1, 1.52, -2.32, 1.4);
    sh.lineTo(-2.22, 0.15);
    sh.lineTo(-1.3, 0.3);
    return sh;
  }

  function buildPlane(color) {
    const plane = new THREE.Group();
    const body = glossy(color);
    const dark = new THREE.MeshPhysicalMaterial({ color: lin(CHARCOAL), roughness: 0.2, clearcoat: 1 });
    const white = glossy(0xf7f7f7);

    // Fuselage: lathe profile along Y (tail at -Y, nose at +Y), then turned to point down +X
    const profile = [
      [0.0, -2.3], [0.1, -2.25], [0.28, -1.9], [0.46, -1.3], [0.55, -0.7], [0.56, 0.9],
      [0.53, 1.35], [0.46, 1.72], [0.34, 2.0], [0.18, 2.17], [0.0, 2.22],
    ].map(([r, y]) => new THREE.Vector2(r, y));
    const fuseGeo = new THREE.LatheGeometry(profile, 48);
    fuseGeo.rotateZ(-Math.PI / 2);
    plane.add(new THREE.Mesh(fuseGeo, body));

    // Wings, low on the fuselage
    [1, -1].forEach((s) => {
      const g = slab(wingShape(s), 0.08);
      g.rotateX(Math.PI / 2);
      const w = new THREE.Mesh(g, body);
      w.position.y = -0.22;
      plane.add(w);

      const sg = slab(stabShape(s), 0.05);
      sg.rotateX(Math.PI / 2);
      const st = new THREE.Mesh(sg, body);
      st.position.y = 0.12;
      plane.add(st);

      // Engine pod under each wing
      const pod = new THREE.Group();
      const nacelleGeo = new THREE.CylinderGeometry(0.21, 0.17, 0.72, 40, 1);
      nacelleGeo.rotateZ(Math.PI / 2);
      pod.add(new THREE.Mesh(nacelleGeo, white));
      const lip = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.035, 16, 40), white);
      lip.rotation.y = Math.PI / 2;
      lip.position.x = 0.36;
      pod.add(lip);
      const fan = new THREE.Mesh(new THREE.CircleGeometry(0.17, 32), dark);
      fan.rotation.y = Math.PI / 2;
      fan.position.x = 0.33;
      pod.add(fan);
      const pylon = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.2, 0.06), body);
      pylon.position.set(-0.02, 0.17, 0);
      pod.add(pylon);
      pod.position.set(0.05, -0.47, 0.95 * s);
      plane.add(pod);

      // Cabin windows
      const winGeo = new THREE.SphereGeometry(0.055, 16, 12);
      winGeo.scale(1, 1.25, 0.5);
      for (let x = -1.05; x <= 1.25; x += 0.26) {
        const win = new THREE.Mesh(winGeo, dark);
        win.position.set(x, 0.17, 0.53 * s);
        plane.add(win);
      }
    });

    const fin = new THREE.Mesh(slab(finShape(), 0.07), body);
    plane.add(fin);

    // Cockpit glass
    const cockpit = new THREE.Mesh(new THREE.SphereGeometry(0.2, 32, 16), dark);
    cockpit.scale.set(0.9, 0.42, 1.95);
    cockpit.position.set(1.78, 0.2, 0);
    plane.add(cockpit);

    // Keychain eyelet on the spine
    const metal = chrome();
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 0.18, 20), metal);
    post.position.set(0.15, 0.6, 0);
    plane.add(post);
    const eye = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.045, 16, 40), metal);
    eye.position.set(0.15, 0.85, 0);
    plane.add(eye);

    return plane;
  }

  // Soft studio reflections without loading an HDR
  function studioEnv(renderer) {
    const env = new THREE.Scene();
    env.background = new THREE.Color(0x8a8a8a);
    const light = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const panels = [
      { s: [6, 0.2, 6], p: [0, 6, 0] },
      { s: [0.2, 4, 6], p: [-7, 2, 0] },
      { s: [0.2, 3, 3], p: [7, 1, 3] },
      { s: [4, 2, 0.2], p: [0, 1, 8] },
    ];
    panels.forEach(({ s, p }) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(...s), light);
      m.position.set(...p);
      env.add(m);
    });
    const pmrem = new THREE.PMREMGenerator(renderer);
    const tex = pmrem.fromScene(env, 0.04).texture;
    pmrem.dispose();
    return tex;
  }

  // One chain link, long axis along Y
  const LINK = 0.26;
  function linkGeometry() {
    const g = new THREE.TorusGeometry(0.1, 0.028, 10, 24);
    g.scale(1, 1.6, 1);
    return g;
  }

  // Where the model sits under its eyelet (matches plane.position below)
  const MODEL_OFFSET = new THREE.Vector3(-0.15, -1.02, 0);
  // Eyelet to center of mass, in model units
  const BODY = 1.0;
  // Farthest collider edge from the center of mass, for quick rejects
  const REACH = 2.6;

  // Compound collider traced over the model: fuselage, wings, engines, tailplanes, fin
  const COLLIDER = [
    [2.0, 0, 0, 0.22], [1.45, 0, 0, 0.48], [0.8, 0, 0, 0.56], [0.1, 0, 0, 0.56],
    [-0.6, 0, 0, 0.54], [-1.25, 0, 0, 0.42], [-1.85, 0, 0, 0.26],
    [0.1, -0.25, 0.85, 0.3], [-0.25, -0.22, 1.45, 0.22], [-0.55, -0.22, 2.0, 0.17],
    [0.1, -0.25, -0.85, 0.3], [-0.25, -0.22, -1.45, 0.22], [-0.55, -0.22, -2.0, 0.17],
    [0.05, -0.47, 0.95, 0.22], [0.05, -0.47, -0.95, 0.22],
    [-2.0, 0.12, 0.55, 0.19], [-2.0, 0.12, -0.55, 0.19],
    [-1.75, 0.7, 0, 0.24], [-2.1, 1.2, 0, 0.17],
  ].map(([x, y, z, r]) => ({ p: new THREE.Vector3(x, y, z).add(MODEL_OFFSET), r }));

  function mountHero(canvas, tags) {
    if (!window.THREE) return;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    // Full-screen canvas: cap the pixel ratio, fill rate is the main GPU cost
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.NoToneMapping;

    const scene = new THREE.Scene();
    scene.environment = studioEnv(renderer);
    const key = new THREE.DirectionalLight(0xffffff, 0.9);
    key.position.set(3, 6, 5);
    scene.add(key);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x9a9a9a, 0.35));

    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
    camera.position.set(0, 0, 15);
    const TAN = Math.tan((camera.fov / 2) * Math.PI / 180);
    const metal = chrome();
    const linkGeo = linkGeometry();

    // Shared keyring all three chains clip onto
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.055, 16, 64), metal);
    scene.add(ring);

    // Category slots 1-3 so the hero charms match the cause colors on the results page.
    // lean: starting angle of the chain off the ring; drop: chain length in links; z: depth lane.
    const specs = [
      { color: 0xeb6834, scale: 0.46, lean: -0.75, drop: 10, z: -0.9, yaw: 2.5 },
      { color: 0x2a78d6, scale: 0.56, lean: 0.05, drop: 14, z: 0.7, yaw: 0.45 },
      { color: 0x1baf7a, scale: 0.46, lean: 0.75, drop: 11, z: -0.4, yaw: -2.3 },
    ];

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const GRAVITY = -9.8;
    const STEP = 1 / 60;
    const MAX_V = 0.2; // max travel per step, keeps throws and hits from blowing up
    let width = 0, height = 0;
    let charms = [];
    const anchor = new THREE.Vector3();

    const halfH = (z) => (camera.position.z - z) * TAN;
    const halfW = (z) => halfH(z) * camera.aspect;
    const particle = (p, w) => ({ p: p.clone(), prev: p.clone(), w });

    // The keyring floats on its own, fully in view below the nav, to the right of the headline
    const base = new THREE.Vector3();
    const home = new THREE.Vector3(); // where the ring lives; it drifts back here after a drag
    function placeAnchor() {
      const narrow = width < 960;
      const navPx = (document.querySelector('.nav') || {}).offsetHeight || 60;
      const unitsPerPx = (2 * halfH(0)) / height;
      const x = (narrow ? 0 : 0.6) * halfW(0);
      base.set(x, halfH(0) - navPx * unitsPerPx - (narrow ? 0.75 : 1.1), 0);
      home.copy(base);
      anchor.copy(base);
      ring.position.copy(anchor);
      charms.forEach((c, i) => c.attach.copy(attachPoint(i)));
    }
    // Carried ring follows the pointer at a capped speed, then coasts to a stop inside the view
    const ringVel = new THREE.Vector3();
    function moveRing() {
      if (drag && drag.ring) {
        tmp.subVectors(drag.target, base);
        const len = tmp.length();
        if (len > MAX_V) tmp.multiplyScalar(MAX_V / len);
        ringVel.copy(tmp);
      } else {
        // Soft spring home: slow pull, heavy damping, so it floats back rather than snapping
        ringVel.addScaledVector(tmp.subVectors(home, base), 0.0012);
        ringVel.multiplyScalar(0.95);
      }
      base.add(ringVel);
      const navPx = (document.querySelector('.nav') || {}).offsetHeight || 60;
      const top = halfH(0) - navPx * ((2 * halfH(0)) / height) - 0.6;
      base.x = THREE.MathUtils.clamp(base.x, -halfW(0) + 0.8, halfW(0) - 0.8);
      base.y = THREE.MathUtils.clamp(base.y, -halfH(0) + 2.5, top);
    }
    function floatRing(t) {
      anchor.set(base.x + Math.sin(t * 0.5) * 0.05, base.y + Math.sin(t * 1.1) * 0.09, base.z);
      ring.position.copy(anchor);
      ring.rotation.set(Math.sin(t * 0.7) * 0.12, 0.35 + Math.sin(t * 0.4) * 0.25, Math.sin(t * 0.9) * 0.06);
      charms.forEach((c, i) => c.attach.copy(attachPoint(i)));
    }
    const attachPoint = (i) => new THREE.Vector3(anchor.x + (i - 1) * 0.18, anchor.y - 0.38, 0);

    function build() {
      charms.forEach((c) => {
        c.links.forEach((m) => scene.remove(m));
        scene.remove(c.holder);
      });
      charms = specs.map((s, i) => {
        const attach = attachPoint(i);
        const dir = new THREE.Vector3(Math.sin(s.lean), -Math.cos(s.lean), 0);
        const pts = [];
        for (let k = 0; k <= s.drop; k++) {
          const p = attach.clone().addScaledVector(dir, k * LINK);
          p.z = (s.z * k) / s.drop;
          pts.push(particle(p, 1));
        }
        const eye = pts[s.drop];
        eye.w = 0.6;
        const body = particle(eye.p.clone().add(new THREE.Vector3(0, -BODY * s.scale, 0)), 0.2);
        const links = [];
        for (let k = 0; k < s.drop; k++) {
          const m = new THREE.Mesh(linkGeo, metal);
          scene.add(m);
          links.push(m);
        }
        const holder = new THREE.Group();
        const plane = buildPlane(s.color);
        plane.position.copy(MODEL_OFFSET);
        holder.add(plane);
        holder.scale.setScalar(s.scale);
        scene.add(holder);
        return {
          ...s, attach, pts, eye, body, links, holder,
          restX: body.p.x, spin: s.yaw, spinVel: 0,
          quat: new THREE.Quaternion(), world: COLLIDER.map(() => new THREE.Vector3()),
        };
      });
      // Settle before the first frame so nothing drops in
      for (let k = 0; k < 300; k++) step(k * STEP);
    }

    let builtFor = { w: 0, h: 0 };
    function resize() {
      const r = canvas.getBoundingClientRect();
      width = r.width; height = r.height;
      if (!width || !height) return;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      placeAnchor();
      const big = Math.abs(width - builtFor.w) > builtFor.w * 0.2 || Math.abs(height - builtFor.h) > builtFor.h * 0.2;
      if (!charms.length || big) {
        builtFor = { w: width, h: height };
        build();
      }
    }

    // ---- grabbing: pick a plane, pull its body across a camera-facing plane ----
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const dragPlane = new THREE.Plane();
    const hit = new THREE.Vector3();
    let drag = null;
    // Text, links and the form keep their normal behavior; only empty space or the planes themselves can grab
    const blocked = (e) => e.target.closest && e.target.closest('input, select, button, a, label, .card, .combo-list, h1, p, .lede');

    function setNdc(e) {
      const r = canvas.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
    }
    // Pick against the collider spheres, not every triangle of the model
    const sphere = new THREE.Sphere();
    const at = new THREE.Vector3();
    function pick() {
      let best = null;
      // The keyring is grabbable too
      sphere.set(anchor, 0.62);
      if (ray.ray.intersectSphere(sphere, at)) best = { ring: true, d: at.distanceTo(ray.ray.origin), point: at.clone() };
      charms.forEach((c) => {
        sphere.set(c.body.p, REACH * c.scale);
        if (!ray.ray.intersectsSphere(sphere)) return;
        COLLIDER.forEach((s, i) => {
          sphere.set(c.world[i], s.r * c.scale * 1.15);
          if (!ray.ray.intersectSphere(sphere, at)) return;
          const dist = at.distanceTo(ray.ray.origin);
          if (!best || dist < best.d) best = { c, d: dist, point: at.clone() };
        });
      });
      return best;
    }

    // The canvas sits behind the page, so listen on the window and only claim hits on a plane
    window.addEventListener('pointerdown', (e) => {
      if (!visible || blocked(e)) return;
      setNdc(e);
      const b = pick();
      if (!b) return;
      e.preventDefault();
      dragPlane.setFromNormalAndCoplanarPoint(camera.getWorldDirection(new THREE.Vector3()).negate(), b.point);
      drag = b.ring
        ? { ring: true, offset: base.clone().sub(b.point), x: e.clientX, target: base.clone() }
        : { c: b.c, offset: b.c.body.p.clone().sub(b.point), x: e.clientX, target: b.c.body.p.clone() };
      document.body.classList.add('grabbing');
      const sel = window.getSelection && window.getSelection();
      if (sel) sel.removeAllRanges();
    });
    window.addEventListener('pointermove', (e) => {
      if (drag) {
        setNdc(e);
        if (ray.ray.intersectPlane(dragPlane, hit)) drag.target.copy(hit).add(drag.offset);
        // Sideways flicks also twist the plane on its eyelet
        if (drag.c) drag.c.spinVel = THREE.MathUtils.clamp(drag.c.spinVel + (e.clientX - drag.x) * 0.002, -0.12, 0.12);
        drag.x = e.clientX;
        return;
      }
      if (!visible || e.pointerType !== 'mouse') return;
      setNdc(e);
      document.body.classList.toggle('can-grab', !blocked(e) && !!pick());
    }, { passive: true });
    const release = () => {
      drag = null;
      document.body.classList.remove('grabbing');
    };
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);

    // ---- physics ----
    const tmp = new THREE.Vector3();
    const d = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const q = new THREE.Quaternion();
    const twist = new THREE.Quaternion();

    // Chain links go slack but never stretch
    function rope(a, b, rest) {
      d.subVectors(b.p, a.p);
      const len = d.length() || 1e-6;
      const wsum = a.w + b.w;
      if (!wsum || len <= rest) return;
      d.multiplyScalar((len - rest) / len / wsum);
      a.p.addScaledVector(d, a.w);
      b.p.addScaledVector(d, -b.w);
    }
    // Eyelet to body is a rigid rod
    function rod(a, b, rest) {
      d.subVectors(b.p, a.p);
      const len = d.length() || 1e-6;
      const wsum = a.w + b.w;
      if (!wsum) return;
      d.multiplyScalar((len - rest) / len / wsum);
      a.p.addScaledVector(d, a.w);
      b.p.addScaledVector(d, -b.w);
    }

    // Plane hangs from eyelet toward its body, twisted by its spin
    function orient(c) {
      d.subVectors(c.eye.p, c.body.p).normalize();
      q.setFromUnitVectors(up, d);
      twist.setFromAxisAngle(up, c.spin);
      c.quat.copy(q).multiply(twist);
    }
    function updateColliders(c) {
      orient(c);
      COLLIDER.forEach((s, i) => {
        c.world[i].copy(s.p).multiplyScalar(c.scale).applyQuaternion(c.quat).add(c.eye.p);
      });
    }

    // Move a particle without giving it the speed of the move (no bounce energy)
    function shove(pt, v, amount, keep) {
      pt.p.addScaledVector(v, amount);
      pt.prev.addScaledVector(v, amount * keep);
    }

    const normal = new THREE.Vector3();
    function collidePlanes(a, b) {
      const reach = REACH * (a.scale + b.scale);
      if (a.body.p.distanceToSquared(b.body.p) > reach * reach) return;
      let best = 0;
      for (let i = 0; i < COLLIDER.length; i++) {
        const ra = COLLIDER[i].r * a.scale;
        for (let j = 0; j < COLLIDER.length; j++) {
          const min = ra + COLLIDER[j].r * b.scale;
          d.subVectors(b.world[j], a.world[i]);
          const len2 = d.lengthSq();
          if (len2 >= min * min) continue;
          const len = Math.sqrt(len2) || 1e-6;
          if (min - len > best) {
            best = min - len;
            normal.copy(d).divideScalar(len);
          }
        }
      }
      if (!best) return;
      const wa = drag && drag.c === a ? 0 : 1;
      const wb = drag && drag.c === b ? 0 : 1;
      if (!wa && !wb) return;
      // Resolve half the overlap per pass and keep most of it out of the velocity
      const k = (best * 0.5) / (wa + wb);
      [a.eye, a.body].forEach((pt) => shove(pt, normal, -k * wa, 0.85));
      [b.eye, b.body].forEach((pt) => shove(pt, normal, k * wb, 0.85));
    }

    // Chains drape over other planes instead of passing through them
    function collideChain(c, other) {
      const reach = REACH * other.scale + 0.05;
      for (let k = 1; k < c.pts.length - 1; k++) {
        const pt = c.pts[k];
        if (pt.p.distanceToSquared(other.body.p) > reach * reach) continue;
        for (let i = 0; i < COLLIDER.length; i++) {
          const min = COLLIDER[i].r * other.scale + 0.04;
          d.subVectors(pt.p, other.world[i]);
          const len2 = d.lengthSq();
          if (len2 >= min * min) continue;
          const len = Math.sqrt(len2) || 1e-6;
          shove(pt, d.divideScalar(len), min - len, 0.7);
        }
      }
    }

    function clampVelocity(pt) {
      d.subVectors(pt.p, pt.prev);
      const v = d.length();
      if (v > MAX_V) pt.prev.copy(pt.p).addScaledVector(d, -MAX_V / v);
    }

    function integrate(pt, wind) {
      if (!pt.w) return;
      tmp.subVectors(pt.p, pt.prev).multiplyScalar(0.985);
      pt.prev.copy(pt.p);
      pt.p.add(tmp);
      pt.p.y += GRAVITY * STEP * STEP;
      pt.p.x += wind * STEP * STEP;
    }

    function step(t) {
      moveRing();
      if (reduce) { anchor.copy(base); ring.position.copy(anchor); charms.forEach((c, i) => c.attach.copy(attachPoint(i))); }
      else floatRing(t);
      const wind = reduce ? 0 : Math.sin(t * 0.6) * 0.2 + Math.sin(t * 1.7) * 0.08;
      charms.forEach((c) => {
        const held = drag && drag.c === c;
        for (let k = 1; k < c.pts.length; k++) integrate(c.pts[k], wind * 0.3);
        if (held) {
          // Follow the pointer at a capped speed so a fast drag can't tear the rope
          tmp.subVectors(drag.target, c.body.p);
          const len = tmp.length();
          if (len > MAX_V) tmp.multiplyScalar(MAX_V / len);
          c.body.prev.copy(c.body.p);
          c.body.p.add(tmp);
        } else {
          integrate(c.body, wind);
          // Soft pull back toward its spot in the bunch, and its own depth lane
          c.body.p.x += (c.restX - c.body.p.x) * 0.0024;
          c.body.p.z += (c.z - c.body.p.z) * 0.008;
        }
      });

      const ITER = 8;
      for (let it = 0; it < ITER; it++) {
        charms.forEach((c) => {
          const held = drag && drag.c === c;
          const bw = c.body.w;
          if (held) c.body.w = 0;
          c.pts[0].p.copy(c.attach);
          c.pts[0].w = 0;
          for (let k = 0; k < c.pts.length - 1; k++) rope(c.pts[k], c.pts[k + 1], LINK);
          rod(c.eye, c.body, BODY * c.scale);
          c.body.w = bw;
        });
        if (it % 4 === 3) {
          charms.forEach(updateColliders);
          for (let i = 0; i < charms.length; i++) {
            for (let j = i + 1; j < charms.length; j++) collidePlanes(charms[i], charms[j]);
          }
          charms.forEach((c) => charms.forEach((o) => { if (o !== c) collideChain(c, o); }));
        }
      }

      charms.forEach((c) => {
        c.pts.forEach(clampVelocity);
        clampVelocity(c.body);
        // Torsion in the chain slowly unwinds the spin
        c.spinVel += (c.yaw - c.spin) * 0.0024;
        c.spinVel *= 0.96;
        c.spin += c.spinVel;
      });
    }

    // ---- draw ----
    function draw() {
      charms.forEach((c, ci) => {
        const pts = c.pts;
        c.links.forEach((m, i) => {
          const a = pts[i].p, b = pts[i + 1].p;
          m.position.addVectors(a, b).multiplyScalar(0.5);
          d.subVectors(a, b).normalize();
          q.setFromUnitVectors(up, d);
          twist.setFromAxisAngle(up, i % 2 ? Math.PI / 2 : 0);
          m.quaternion.copy(q).multiply(twist);
        });
        orient(c);
        c.holder.position.copy(c.eye.p);
        c.holder.quaternion.copy(c.quat);

        const tag = tags[ci];
        if (tag) {
          tmp.set(0, -2.0, 0).multiplyScalar(c.scale).applyQuaternion(c.quat).add(c.eye.p).project(camera);
          tag.style.transform = `translate(-50%, 0) translate(${((tmp.x + 1) / 2) * width}px, ${((1 - tmp.y) / 2) * height}px)`;
        }
      });
      renderer.render(scene, camera);
    }

    let visible = true;
    new IntersectionObserver(([e]) => { visible = e.isIntersecting; }).observe(canvas);
    resize();
    window.addEventListener('resize', resize);

    const clock = new THREE.Clock();
    let acc = 0, simT = 5;
    function frame() {
      requestAnimationFrame(frame);
      const dt = Math.min(clock.getDelta(), 0.05);
      if (!visible) return;
      acc += dt;
      while (acc >= STEP) { simT += STEP; step(simT); acc -= STEP; }
      draw();
    }
    frame();
  }

  window.FPPlane = { mountHero, buildPlane };
})();
