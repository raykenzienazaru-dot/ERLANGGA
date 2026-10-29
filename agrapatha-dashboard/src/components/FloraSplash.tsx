import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';

interface FloraSplashProps {
  onComplete: () => void;
}

export const FloraSplash: React.FC<FloraSplashProps> = ({ onComplete }) => {
  const [revealed, setRevealed] = useState(false);
  const [scaled, setScaled] = useState(false);
  const [closing, setClosing] = useState(false);
  const [isWatering, setIsWatering] = useState(false);

  const canvasHostRef = useRef<HTMLDivElement>(null);
  const fgLayerRef = useRef<HTMLDivElement>(null);
  const bgLayerRef = useRef<HTMLDivElement>(null);
  const wateringRef = useRef(false);

  useEffect(() => {
    wateringRef.current = isWatering;
  }, [isWatering]);

  useEffect(() => {
    const t1 = setTimeout(() => setRevealed(true), 120);
    const t2 = setTimeout(() => setScaled(true), 450);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []);

  useEffect(() => {
    const host = canvasHostRef.current;
    if (!host) return;

    let renderer: THREE.WebGLRenderer | null = null;
    let animId = 0;
    let scene: THREE.Scene | null = null;
    let camera: THREE.PerspectiveCamera | null = null;

    const rootGroup = new THREE.Group();
    const plantGroup = new THREE.Group();
    const potCanGroup = new THREE.Group();
    const dropletGroup = new THREE.Group();

    const targetParallax = { x: 0, y: 0 };
    const currentParallax = { x: 0, y: 0 };
    let isDragging = false;
    let prevPointer = { x: 0, y: 0 };
    let rotYTarget = 0;
    let rotXTarget = 0;
    let rotYCurrent = 0;
    let rotXCurrent = 0;
    let velY = 0;
    let velX = 0;

    try {
      scene = new THREE.Scene();
      camera = new THREE.PerspectiveCamera(34, host.clientWidth / (host.clientHeight || 1), 0.1, 50);
      camera.position.set(0, 1.42, 5.2);
      camera.lookAt(0, 1.15, 0);

      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setSize(host.clientWidth, host.clientHeight);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.18;
      host.appendChild(renderer.domElement);

      const ambientLight = new THREE.AmbientLight(0xfff9ed, 1.15);
      scene.add(ambientLight);

      const dirLight1 = new THREE.DirectionalLight(0xfff5dd, 1.95);
      dirLight1.position.set(4, 7, 4);
      scene.add(dirLight1);

      const dirLight2 = new THREE.DirectionalLight(0x9db312, 1.25);
      dirLight2.position.set(-4, 3, -2);
      scene.add(dirLight2);

      scene.add(rootGroup);
      rootGroup.position.set(0, -0.06, 0);
      rootGroup.add(plantGroup);
      rootGroup.add(potCanGroup);
      rootGroup.add(dropletGroup);

      // Floor radial shadow texture
      const shadowCanvas = document.createElement('canvas');
      shadowCanvas.width = 256;
      shadowCanvas.height = 256;
      const ctx = shadowCanvas.getContext('2d');
      if (ctx) {
        const grad = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
        grad.addColorStop(0, 'rgba(20, 32, 5, 0.58)');
        grad.addColorStop(0.35, 'rgba(24, 38, 6, 0.32)');
        grad.addColorStop(0.68, 'rgba(30, 48, 8, 0.08)');
        grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 256, 256);
      }
      const shadowTex = new THREE.CanvasTexture(shadowCanvas);
      const shadowGeo = new THREE.PlaneGeometry(2.5, 2.5);
      const shadowMat = new THREE.MeshBasicMaterial({
        map: shadowTex,
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
      });
      const shadowMesh = new THREE.Mesh(shadowGeo, shadowMat);
      shadowMesh.rotation.x = -Math.PI / 2;
      shadowMesh.position.set(0, 0.01, 0);
      plantGroup.add(shadowMesh);

      // Ceramic pot
      const potGeo = new THREE.CylinderGeometry(0.65, 0.46, 0.76, 32);
      const potMat = new THREE.MeshStandardMaterial({ color: 0xf6f9f5, roughness: 0.22, metalness: 0.06 });
      const potMesh = new THREE.Mesh(potGeo, potMat);
      potMesh.position.y = 0.38;
      plantGroup.add(potMesh);

      // Pot rim
      const rimGeo = new THREE.TorusGeometry(0.65, 0.03, 16, 32);
      const rimMat = new THREE.MeshStandardMaterial({ color: 0x597c00, roughness: 0.3, metalness: 0.25 });
      const rimMesh = new THREE.Mesh(rimGeo, rimMat);
      rimMesh.rotation.x = Math.PI / 2;
      rimMesh.position.y = 0.76;
      plantGroup.add(rimMesh);

      // Soil disc
      const soilGeo = new THREE.CylinderGeometry(0.62, 0.62, 0.06, 32);
      const soilMat = new THREE.MeshStandardMaterial({ color: 0x2e2318, roughness: 0.92 });
      const soilMesh = new THREE.Mesh(soilGeo, soilMat);
      soilMesh.position.y = 0.74;
      plantGroup.add(soilMesh);

      // Curved stem
      const stemCurve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, 0.74, 0),
        new THREE.Vector3(0.04, 1.12, 0.02),
        new THREE.Vector3(-0.03, 1.5, -0.02),
        new THREE.Vector3(0.02, 1.82, 0.01),
        new THREE.Vector3(0, 2.05, 0),
      ]);
      const stemGeo = new THREE.TubeGeometry(stemCurve, 24, 0.034, 12, false);
      const stemMat = new THREE.MeshStandardMaterial({ color: 0x597c00, roughness: 0.45 });
      const stemMesh = new THREE.Mesh(stemGeo, stemMat);
      plantGroup.add(stemMesh);

      // Botanical leaves
      const leafGeo = new THREE.SphereGeometry(0.34, 20, 16);
      leafGeo.scale(1, 0.15, 1.82);
      const leafMat = new THREE.MeshStandardMaterial({ color: 0x9db312, roughness: 0.24, metalness: 0.12 });
      const leafConfigs = [
        { pos: [0.21, 1.12, 0.11], rot: [0.36, 0.5, -0.5], scale: 0.92 },
        { pos: [-0.19, 1.34, -0.08], rot: [-0.3, -0.6, 0.58], scale: 1.05 },
        { pos: [0.18, 1.6, -0.13], rot: [-0.34, 0.8, -0.4], scale: 1.1 },
        { pos: [-0.15, 1.82, 0.14], rot: [0.32, -0.7, 0.45], scale: 1.0 },
        { pos: [0.09, 1.98, 0.04], rot: [0.16, 0.26, -0.2], scale: 0.85 },
        { pos: [-0.02, 2.12, -0.02], rot: [-0.1, 0.08, 0.1], scale: 0.7 },
      ];
      const leafMeshes: THREE.Mesh[] = [];
      leafConfigs.forEach((cfg) => {
        const mesh = new THREE.Mesh(leafGeo, leafMat.clone());
        mesh.position.set(cfg.pos[0], cfg.pos[1], cfg.pos[2]);
        mesh.rotation.set(cfg.rot[0], cfg.rot[1], cfg.rot[2]);
        mesh.scale.setScalar(cfg.scale);
        plantGroup.add(mesh);
        leafMeshes.push(mesh);
      });

      // Floating watering pitcher
      potCanGroup.position.set(0.58, 2.52, 0.2);
      const canMat = new THREE.MeshStandardMaterial({ color: 0x597c00, roughness: 0.32, metalness: 0.28 });
      const canBodyGeo = new THREE.CylinderGeometry(0.22, 0.17, 0.33, 20);
      potCanGroup.add(new THREE.Mesh(canBodyGeo, canMat));

      const handleGeo = new THREE.TorusGeometry(0.17, 0.02, 12, 24, Math.PI);
      const handleMesh = new THREE.Mesh(handleGeo, canMat);
      handleMesh.rotation.z = -Math.PI / 2;
      handleMesh.position.set(0.2, 0.08, 0);
      potCanGroup.add(handleMesh);

      const spoutGeo = new THREE.CylinderGeometry(0.028, 0.055, 0.34, 16);
      const spoutMesh = new THREE.Mesh(spoutGeo, canMat);
      spoutMesh.rotation.z = Math.PI / 2.8;
      spoutMesh.position.set(-0.23, 0.11, 0);
      potCanGroup.add(spoutMesh);

      const nozzleGeo = new THREE.CylinderGeometry(0.075, 0.038, 0.055, 16);
      const nozzleMat = new THREE.MeshStandardMaterial({ color: 0x9db312, roughness: 0.2, metalness: 0.55 });
      const nozzleMesh = new THREE.Mesh(nozzleGeo, nozzleMat);
      nozzleMesh.rotation.z = Math.PI / 2.8;
      nozzleMesh.position.set(-0.36, 0.18, 0);
      potCanGroup.add(nozzleMesh);

      // Water droplets
      const dropCount = 75;
      const dropPos = new Float32Array(dropCount * 3);
      const dropSpeeds = new Float32Array(dropCount);
      for (let i = 0; i < dropCount; i++) {
        dropPos[i * 3] = (Math.random() - 0.5) * 0.14;
        dropPos[i * 3 + 1] = 2.45 + Math.random() * 0.15;
        dropPos[i * 3 + 2] = (Math.random() - 0.5) * 0.14;
        dropSpeeds[i] = 0.05 + Math.random() * 0.025;
      }
      const dropBufferGeo = new THREE.BufferGeometry();
      dropBufferGeo.setAttribute('position', new THREE.BufferAttribute(dropPos, 3));
      const dropPointsMat = new THREE.PointsMaterial({
        color: 0x38bdf8,
        size: 0.075,
        transparent: true,
        opacity: 0.88,
      });
      const dropPoints = new THREE.Points(dropBufferGeo, dropPointsMat);
      dropPoints.visible = false;
      dropletGroup.add(dropPoints);

      const onPointerMove = (e: PointerEvent) => {
        const nx = (e.clientX / window.innerWidth - 0.5) * 2;
        const ny = (e.clientY / window.innerHeight - 0.5) * 2;
        targetParallax.x = nx;
        targetParallax.y = ny;
        if (isDragging) {
          const dx = e.clientX - prevPointer.x;
          const dy = e.clientY - prevPointer.y;
          velY = dx * 0.007;
          velX = dy * 0.004;
          rotYTarget += velY;
          rotXTarget = Math.max(-0.25, Math.min(0.3, rotXTarget + velX));
          prevPointer = { x: e.clientX, y: e.clientY };
        }
      };

      const onPointerDown = (e: PointerEvent) => {
        isDragging = true;
        prevPointer = { x: e.clientX, y: e.clientY };
        velY = 0;
        velX = 0;
      };

      const onPointerUp = () => {
        isDragging = false;
      };

      const domEl = renderer.domElement;
      domEl.style.touchAction = 'none';
      domEl.style.cursor = 'grab';
      domEl.addEventListener('pointerdown', onPointerDown);
      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);

      const startTime = performance.now();
      let canTilt = 0;

      const animate = () => {
        animId = requestAnimationFrame(animate);
        const elapsed = (performance.now() - startTime) * 0.001;
        const activeWater = wateringRef.current;

        currentParallax.x += (targetParallax.x - currentParallax.x) * 0.05;
        currentParallax.y += (targetParallax.y - currentParallax.y) * 0.05;

        if (fgLayerRef.current) {
          fgLayerRef.current.style.transform = `translate3d(${currentParallax.x}%, ${currentParallax.y}%, 0) rotateX(${-currentParallax.y * 0.25}deg) rotateY(${currentParallax.x * 0.25}deg)`;
        }
        if (bgLayerRef.current) {
          bgLayerRef.current.style.transform = `translate3d(${currentParallax.x * 0.5}%, ${currentParallax.y * 0.5}%, 0)`;
        }

        if (!isDragging) {
          velY *= 0.92;
          velX *= 0.92;
          rotYTarget += velY;
          rotXTarget += velX;
        }
        rotYCurrent += (rotYTarget - rotYCurrent) * 0.1;
        rotXCurrent += (rotXTarget - rotXCurrent) * 0.1;

        plantGroup.rotation.y = rotYCurrent + Math.sin(elapsed * 0.45) * 0.07;
        plantGroup.rotation.x = rotXCurrent;
        plantGroup.position.y = Math.sin(elapsed * 0.8) * 0.008;

        leafMeshes.forEach((leaf, idx) => {
          const sway = Math.sin(elapsed * 1.5 + idx) * 0.0016;
          const vibr = activeWater ? Math.sin(elapsed * 12 + idx) * 0.0025 : 0;
          leaf.rotation.z += sway + vibr;
        });

        const targetTilt = activeWater ? -0.48 : 0;
        const targetCanX = activeWater ? 0.35 : 0.58;
        const targetCanY = activeWater ? 2.42 : 2.52;
        canTilt += (targetTilt - canTilt) * 0.12;
        potCanGroup.rotation.z = canTilt;
        potCanGroup.position.x += (targetCanX - potCanGroup.position.x) * 0.1;
        potCanGroup.position.y += (targetCanY - potCanGroup.position.y) * 0.1;

        if (activeWater) {
          dropPoints.visible = true;
          const posAttr = dropBufferGeo.attributes.position as THREE.BufferAttribute;
          const arr = posAttr.array as Float32Array;
          for (let i = 0; i < dropCount; i++) {
            arr[i * 3 + 1] -= dropSpeeds[i];
            if (arr[i * 3 + 1] < 0.76) {
              arr[i * 3] = (Math.random() - 0.5) * 0.14;
              arr[i * 3 + 1] = 2.45 + Math.random() * 0.15;
              arr[i * 3 + 2] = (Math.random() - 0.5) * 0.14;
            }
          }
          posAttr.needsUpdate = true;
        } else {
          dropPoints.visible = false;
        }

        if (renderer && scene && camera) {
          renderer.render(scene, camera);
        }
      };

      animate();

      const onResize = () => {
        if (!host || !renderer || !camera) return;
        camera.aspect = host.clientWidth / (host.clientHeight || 1);
        camera.updateProjectionMatrix();
        renderer.setSize(host.clientWidth, host.clientHeight);
      };
      window.addEventListener('resize', onResize);

      return () => {
        if (animId) cancelAnimationFrame(animId);
        window.removeEventListener('resize', onResize);
        domEl.removeEventListener('pointerdown', onPointerDown);
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        if (renderer) {
          renderer.dispose();
          if (renderer.domElement && host.contains(renderer.domElement)) {
            host.removeChild(renderer.domElement);
          }
        }
      };
    } catch {
      // Fallback if WebGL unavailable
    }
  }, []);

  const handleEnterDashboard = () => {
    setClosing(true);
    setTimeout(() => {
      onComplete();
    }, 1150);
  };

  return (
    <div
      className={`fixed inset-0 z-50 overflow-hidden select-none pointer-events-auto transition-colors duration-300 ${
        closing ? 'bg-transparent' : 'bg-[#1E2805]'
      }`}
    >
      <div
        className="w-full h-full bg-[#EFEFEE] relative flex flex-col justify-between p-3 sm:p-5 md:p-6 lg:p-8 overflow-hidden"
        style={{
          clipPath: closing
            ? 'circle(0% at 50% 50%)'
            : revealed
            ? 'circle(160% at 50% 50%)'
            : 'circle(0% at 50% 50%)',
          transform: closing ? 'scale(0.96)' : scaled ? 'scale(1)' : 'scale(1.8)',
          transition: closing
            ? 'clip-path 1.15s cubic-bezier(0.65, 0, 0.35, 1), transform 1.15s cubic-bezier(0.65, 0, 0.35, 1)'
            : 'clip-path 2.2s cubic-bezier(0.22, 1, 0.36, 1), transform 1.9s cubic-bezier(0.22, 1, 0.36, 1)',
        }}
      >
        {/* SVG Polygon Gradients */}
        <svg className="absolute w-0 h-0 pointer-events-none" aria-hidden="true">
          <defs>
            <linearGradient id="polyGradLimeGreen" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#BEF264" stopOpacity="0.65" />
              <stop offset="100%" stopColor="#22C55E" stopOpacity="0.5" />
            </linearGradient>
            <linearGradient id="polyGradBrightLime" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#A3E635" stopOpacity="0.7" />
              <stop offset="100%" stopColor="#65A30D" stopOpacity="0.45" />
            </linearGradient>
            <linearGradient id="polyGradEmeraldLime" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#4ADE80" stopOpacity="0.65" />
              <stop offset="100%" stopColor="#A3E635" stopOpacity="0.5" />
            </linearGradient>
            <linearGradient id="polyGradMintLime" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#6EE7B7" stopOpacity="0.7" />
              <stop offset="100%" stopColor="#84CC16" stopOpacity="0.5" />
            </linearGradient>
            <linearGradient id="polyGradSpringGreen" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#86EFAC" stopOpacity="0.65" />
              <stop offset="100%" stopColor="#16A34A" stopOpacity="0.45" />
            </linearGradient>
          </defs>
        </svg>

        {/* Floating Organic Polygons Layer */}
        <div ref={bgLayerRef} className="absolute inset-0 pointer-events-none transition-transform duration-75">
          <div className="absolute top-6 left-12 w-16 h-16 animate-organic-1" style={{ filter: 'blur(6px)' }}>
            <svg viewBox="0 0 100 100" className="w-full h-full">
              <polygon points="50,0 93.3,25 93.3,75 50,100 6.7,75 6.7,25" fill="url(#polyGradLimeGreen)" />
            </svg>
          </div>
          <div className="absolute top-24 left-6 w-10 h-10 animate-organic-2" style={{ filter: 'blur(4px)' }}>
            <svg viewBox="0 0 100 100" className="w-full h-full">
              <polygon points="50,5 95,95 5,95" fill="url(#polyGradBrightLime)" />
            </svg>
          </div>
          <div className="absolute top-14 left-44 w-7 h-7 animate-organic-3" style={{ filter: 'blur(3px)' }}>
            <svg viewBox="0 0 100 100" className="w-full h-full">
              <polygon points="50,0 100,50 50,100 0,50" fill="url(#polyGradEmeraldLime)" />
            </svg>
          </div>
          <div className="absolute top-12 left-[42%] w-10 h-10 animate-organic-3" style={{ filter: 'blur(5px)' }}>
            <svg viewBox="0 0 100 100" className="w-full h-full">
              <polygon points="50,0 100,50 50,100 0,50" fill="url(#polyGradMintLime)" />
            </svg>
          </div>
          <div className="absolute top-20 left-[53%] w-8 h-8 animate-organic-1" style={{ filter: 'blur(3px)' }}>
            <svg viewBox="0 0 100 100" className="w-full h-full">
              <polygon points="50,0 93.3,25 93.3,75 50,100 6.7,75 6.7,25" fill="url(#polyGradSpringGreen)" />
            </svg>
          </div>
          <div className="absolute top-4 right-14 w-16 h-16 animate-organic-2" style={{ filter: 'blur(6px)' }}>
            <svg viewBox="0 0 100 100" className="w-full h-full">
              <polygon points="50,0 98,35 79,95 21,95 2,35" fill="url(#polyGradLimeGreen)" />
            </svg>
          </div>
          <div className="absolute top-24 right-8 w-10 h-10 animate-organic-1" style={{ filter: 'blur(4px)' }}>
            <svg viewBox="0 0 100 100" className="w-full h-full">
              <polygon points="50,5 95,95 5,95" fill="url(#polyGradBrightLime)" />
            </svg>
          </div>
          <div className="absolute top-[46%] -left-2 w-14 h-14 animate-organic-2" style={{ filter: 'blur(5px)' }}>
            <svg viewBox="0 0 100 100" className="w-full h-full">
              <polygon points="50,0 100,50 50,100 0,50" fill="url(#polyGradBrightLime)" />
            </svg>
          </div>
          <div className="absolute top-[45%] -right-2 w-16 h-16 animate-organic-1" style={{ filter: 'blur(6px)' }}>
            <svg viewBox="0 0 100 100" className="w-full h-full">
              <polygon points="30,0 70,0 100,30 100,70 70,100 30,100 0,70 0,30" fill="url(#polyGradEmeraldLime)" />
            </svg>
          </div>
          <div className="absolute bottom-16 left-8 w-14 h-14 animate-organic-1" style={{ filter: 'blur(5px)' }}>
            <svg viewBox="0 0 100 100" className="w-full h-full">
              <polygon points="50,5 95,95 5,95" fill="url(#polyGradMintLime)" />
            </svg>
          </div>
          <div className="absolute bottom-14 right-12 w-14 h-14 animate-organic-2" style={{ filter: 'blur(5px)' }}>
            <svg viewBox="0 0 100 100" className="w-full h-full">
              <polygon points="50,0 98,35 79,95 21,95 2,35" fill="url(#polyGradLimeGreen)" />
            </svg>
          </div>
        </div>

        {/* Foreground Content */}
        <div
          ref={fgLayerRef}
          className="relative z-20 w-full h-full flex flex-col justify-between transition-transform duration-75 ease-out"
        >
          {/* Top Bar */}
          <header className="w-full flex items-center justify-center pt-1 sm:pt-2">
            <div className="inline-flex items-center gap-3 sm:gap-6 md:gap-8 text-[11px] sm:text-xs font-jakarta-bold tracking-widest select-none">
              <span className="animate-text-flora-color">BOTANICAL & FOREST</span>
              <span className="animate-text-flora-color">INTELLIGENCE</span>
              <div className="flex items-center gap-2 sm:gap-3 px-1 sm:px-2">
                <span className="animate-float-3p-1 text-[#597C00] inline-block" title="Botanical Star">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 0 C12 7 17 12 24 12 C17 12 12 17 12 24 C12 17 7 12 0 12 C7 12 12 7 12 0 Z" />
                  </svg>
                </span>
                <span className="animate-float-3p-2 text-[#9DB312] inline-block" title="Botanical Star">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 0 C12 7 17 12 24 12 C17 12 12 17 12 24 C12 17 7 12 0 12 C7 12 12 7 12 0 Z" />
                  </svg>
                </span>
                <span className="animate-float-3p-3 text-[#597C00] inline-block" title="Botanical Star">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 0 C12 7 17 12 24 12 C17 12 12 17 12 24 C12 17 7 12 0 12 C7 12 12 7 12 0 Z" />
                  </svg>
                </span>
              </div>
              <span className="animate-text-flora-color">MODEL_HAZARD.H</span>
              <span className="animate-text-flora-color">PRECISION</span>
            </div>
          </header>

          {/* Center Welcome & 3D Plant */}
          <main className="w-full max-w-6xl mx-auto flex-1 min-h-0 flex flex-col lg:flex-row items-center justify-between gap-4 sm:gap-6 my-auto py-1">
            <div className="flex-1 pr-0 lg:pr-6 z-20 w-full flex flex-col justify-center">
              <div className="relative inline-block">
                <div className="flex items-baseline leading-none">
                  <span className="font-marck-script text-6xl sm:text-7xl md:text-8xl lg:text-[105px] xl:text-[120px] leading-none inline-block mr-3 sm:mr-4 lg:-mr-2 translate-y-1 sm:translate-y-2 select-none relative z-10 flora-gradient-text">
                    W
                  </span>
                  <span className="font-jakarta-bold text-3xl sm:text-4xl md:text-5xl lg:text-6xl xl:text-7xl tracking-tight select-none inline-block flora-gradient-text relative z-0">
                    ELCOME
                  </span>
                </div>
                <div className="font-jakarta-bold text-base sm:text-lg md:text-xl lg:text-2xl tracking-tight uppercase select-none mt-1 pl-1 animate-text-flora-color">
                  AGRAPATHA SYSTEM
                </div>
                <p className="text-xs sm:text-sm text-[#617253] max-w-md mt-3 pl-1 leading-relaxed">
                  Integrasi langsung <code className="text-[#597C00] font-mono font-bold">model_hazard.h</code> (100-Tree Random Forest) &amp; <code className="text-[#597C00] font-mono font-bold">grenvis_sensor_model.h</code> berbasis dataset Kaggle Montesinho (<strong className="text-[#1B2408]">517 sampel</strong>) dan FLORA Environmental Risk (<strong className="text-[#1B2408]">9.000 sampel</strong>).
                </p>
              </div>
            </div>

            <div className="flex-1 flex items-center justify-center lg:justify-end z-20 relative w-full">
              <div className="relative w-[270px] h-[290px] sm:w-[320px] sm:h-[340px] md:w-[370px] md:h-[390px] lg:w-[420px] lg:h-[440px] max-h-[48vh] flex items-center justify-center overflow-visible">
                <div
                  ref={canvasHostRef}
                  className="w-full h-full cursor-grab active:cursor-grabbing outline-none block relative z-10"
                  title="Klik dan geser untuk memutar objek 3D"
                />
                <div className="absolute top-2 right-2 z-30">
                  <button
                    onClick={() => setIsWatering((v) => !v)}
                    className={`glass-btn-shine px-3 py-1 rounded-xl text-xs font-jakarta-semibold transition-all cursor-pointer flex items-center gap-1.5 shadow-sm ${
                      isWatering
                        ? 'bg-[#38bdf8]/30 border-[#0284c7] text-[#0369a1] ring-2 ring-[#38bdf8]/40 animate-pulse'
                        : 'bg-white/80 border-white/90 text-[#597C00] hover:bg-white'
                    }`}
                    title="Klik untuk menguji aktuator penyiraman / pendinginan kanopi 3D"
                  >
                    <span>{isWatering ? 'Menyiram...' : 'Siram Kanopi'}</span>
                  </button>
                </div>
              </div>
            </div>
          </main>

          {/* Bottom Bar */}
          <footer className="w-full flex flex-col md:flex-row items-center justify-between gap-3 sm:gap-4 pt-1">
            <div className="flex items-center gap-4 sm:gap-6 text-[10px] sm:text-[11px] font-jakarta-bold tracking-wider">
              <div className="leading-snug animate-text-flora-color-delayed">
                <div>SENSORS</div>
                <div className="text-[#597C00]">+ TELEMETRY</div>
              </div>
              <div className="leading-snug animate-text-flora-color-delayed">
                <div>VISION</div>
                <div className="text-[#597C00]">+ AI-INFER</div>
              </div>
              <div className="leading-snug animate-text-flora-color-delayed">
                <div>ROBOTIC</div>
                <div className="text-[#597C00]">+ ACTUATOR</div>
              </div>
            </div>
            <div className="hidden md:block flex-1" />
            <div className="flex items-start gap-2.5 max-w-xs text-left">
              <span className="text-[#597C00] mt-0.5 shrink-0">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 0 C12 7 17 12 24 12 C17 12 12 17 12 24 C12 17 7 12 0 12 C7 12 12 7 12 0 Z" />
                  <circle cx="12" cy="12" r="2.5" fill="#EFEFEE" />
                </svg>
              </span>
              <p className="text-[9px] sm:text-[10px] leading-relaxed select-none animate-text-flora-color-delayed">
                Autonomous forest fire &amp; botanical observation ecosystem powered by C header Edge-AI (model_hazard.h), FWI microclimate telemetry, and L298N rail actuation.
              </p>
            </div>
          </footer>
        </div>

        {/* Center Enter Button */}
        <div className="fixed bottom-4 sm:bottom-6 left-1/2 -translate-x-1/2 z-30 flex flex-col items-center pointer-events-auto">
          <div className="text-[10px] sm:text-[11px] font-jakarta-bold tracking-[0.25em] animate-text-flora-color uppercase select-none mb-1.5 text-center">
            AGRAPATHA INTELLIGENCE
          </div>
          <button
            onClick={handleEnterDashboard}
            className="glass-btn-shine px-6 py-2.5 rounded-full text-xs font-jakarta-bold tracking-wider text-[#1E2805] cursor-pointer shadow-sm hover:shadow-md hover:scale-105 active:scale-95 transition-all"
          >
            Masuk Dashboard
          </button>
        </div>
      </div>
    </div>
  );
};
