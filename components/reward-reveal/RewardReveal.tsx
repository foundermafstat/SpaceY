"use client";

import { Canvas, useFrame, useLoader, useThree } from "@react-three/fiber";
import { Bloom, ChromaticAberration, EffectComposer, Noise, Vignette } from "@react-three/postprocessing";
import { gsap } from "gsap";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { RARITY_VFX } from "./rarity-config";
import type { RarityVfxConfig, RewardRevealMode, RewardRevealProps } from "./types";

type TimelineState = {
  cardAlpha: number;
  cardRotation: number;
  cardScale: number;
  echoAlpha: number;
  echoSpread: number;
  flip: number;
  flash: number;
  glitch: number;
  particleAlpha: number;
  portal: number;
  prism: number;
  ring: number;
  shardAlpha: number;
  shake: number;
  streakAlpha: number;
};

const CARD_WIDTH = 2.1;
const CARD_HEIGHT = 2.94;
const TMP_OBJECT = new THREE.Object3D();

export function RewardReveal({
  rarity,
  cardBackTextureUrl,
  cardTextureUrl,
  mode = "single",
  showCard = true,
  dpr = [1, 2],
  autoplay = true,
  className = "",
  replayKey = 0,
  onComplete
}: RewardRevealProps) {
  const config = RARITY_VFX[rarity];
  const revealClassName = `reward-reveal reward-reveal--${mode} ${className}`.trim();

  return (
    <div className={revealClassName} aria-hidden="true">
      <Canvas
        orthographic
        camera={{ position: [0, 0, 8], zoom: 100, near: 0.1, far: 40 }}
        dpr={dpr}
        gl={{ alpha: true, antialias: true, powerPreference: "high-performance" }}
        onCreated={({ gl }) => {
          gl.outputColorSpace = THREE.SRGBColorSpace;
          gl.toneMapping = THREE.ACESFilmicToneMapping;
        }}
      >
        <Suspense fallback={null}>
          <RewardRevealScene
            autoplay={autoplay}
            cardBackTextureUrl={cardBackTextureUrl}
            cardTextureUrl={cardTextureUrl}
            config={config}
            mode={mode}
            replayKey={replayKey}
            showCard={showCard}
            onComplete={onComplete}
          />
        </Suspense>
      </Canvas>
    </div>
  );
}

function RewardRevealScene({
  autoplay,
  cardBackTextureUrl,
  cardTextureUrl,
  config,
  mode,
  replayKey,
  showCard,
  onComplete
}: {
  autoplay: boolean;
  cardBackTextureUrl: string;
  cardTextureUrl: string;
  config: RarityVfxConfig;
  mode: RewardRevealMode;
  replayKey: number;
  showCard: boolean;
  onComplete?: () => void;
}) {
  const frontTexture = useCardTexture(cardTextureUrl);
  const backTexture = useCardTexture(cardBackTextureUrl);
  const reduced = useReducedMotion();
  const timeline = useRef<TimelineState>(createInitialTimelineState());
  const { viewport } = useThree();
  const mobile = viewport.width < 6;

  useRewardTimeline(timeline, config, autoplay, replayKey, reduced, onComplete);
  const packMode = mode === "packCard";
  const density = (mobile ? 0.65 : 1) * (packMode ? 0.72 : 1);
  const sceneScale = packMode ? 0.74 : 1;

  return (
    <>
      <CameraShake state={timeline} strength={reduced ? 0.25 : 1} />
      <group scale={sceneScale}>
        <PortalBackdrop config={config} state={timeline} reduced={reduced} />
        <SpeedLines config={config} state={timeline} count={Math.max(4, Math.round(config.streaks * density))} reduced={reduced} />
        <GlitchBars config={config} state={timeline} />
        {showCard ? <EchoCards config={config} side="back" state={timeline} texture={backTexture} count={Math.max(1, Math.round(config.echoes * density))} /> : null}
        {showCard ? <EchoCards config={config} side="front" state={timeline} texture={frontTexture} count={Math.max(1, Math.round(config.echoes * density))} /> : null}
        <CrystalShards config={config} state={timeline} count={Math.max(3, Math.round(config.shards * density))} reduced={reduced} />
        <AlphaEdgeParticles config={config} state={timeline} count={Math.max(14, Math.round(config.particles * density))} reduced={reduced} />
        {showCard ? <MainRewardCard backTexture={backTexture} config={config} frontTexture={frontTexture} state={timeline} reduced={reduced} /> : null}
        <RarityBursts config={config} state={timeline} reduced={reduced} />
      </group>
      <FullScreenFlash color={config.colors.flash} intensity={packMode ? 0.28 : 0.62} state={timeline} />
      <EffectComposer multisampling={0}>
        <Bloom intensity={config.bloom * (mobile ? 0.74 : 1) * (packMode ? 0.82 : 1)} luminanceThreshold={0.04} luminanceSmoothing={0.32} mipmapBlur />
        <ChromaticAberration offset={[config.chromatic * (reduced ? 0.35 : 1), config.chromatic * 0.7]} />
        <Noise opacity={reduced ? 0.012 : 0.025} />
        <Vignette offset={0.04} darkness={0.72} />
      </EffectComposer>
    </>
  );
}

function useCardTexture(cardTextureUrl: string) {
  const loaded = useLoader(THREE.TextureLoader, cardTextureUrl);
  const texture = useMemo(() => {
    const nextTexture = loaded.clone();
    nextTexture.colorSpace = THREE.SRGBColorSpace;
    nextTexture.wrapS = THREE.ClampToEdgeWrapping;
    nextTexture.wrapT = THREE.ClampToEdgeWrapping;
    nextTexture.minFilter = THREE.LinearMipmapLinearFilter;
    nextTexture.magFilter = THREE.LinearFilter;
    nextTexture.generateMipmaps = true;
    nextTexture.needsUpdate = true;
    return nextTexture;
  }, [loaded]);

  useEffect(() => () => texture.dispose(), [texture]);

  return texture;
}

function useRewardTimeline(
  state: React.RefObject<TimelineState>,
  config: RarityVfxConfig,
  autoplay: boolean,
  replayKey: number,
  reduced: boolean,
  onComplete?: () => void
) {
  useEffect(() => {
    const current = state.current;
    if (!current) {
      return;
    }

    gsap.killTweensOf(current);
    Object.assign(current, createInitialTimelineState());

    const motion = reduced ? 0.42 : 1;
    const duration = config.duration * (reduced ? 0.72 : 1);
    const timeline = gsap.timeline({
      paused: !autoplay,
      defaults: { ease: "power3.out" },
      onComplete
    });

    timeline
      .to(current, {
        cardAlpha: 0.38,
        cardRotation: -0.22 * config.shake * motion,
        cardScale: 0.72,
        echoAlpha: 0.22,
        echoSpread: 0.18,
        flip: 0,
        portal: 0.46,
        ring: 0.28,
        streakAlpha: 0.22,
        duration: duration * 0.12
      })
      .to(
        current,
        {
          cardRotation: 0.18 * config.shake * motion,
          cardScale: 0.94,
          echoAlpha: 0.76,
          echoSpread: 0.76,
          flip: 0.12,
          glitch: 0.8 * motion,
          particleAlpha: 0.26,
          portal: 0.86,
          ring: 0.78,
          shardAlpha: 0.58,
          streakAlpha: 0.7,
          duration: duration * 0.28
        },
        ">-0.02"
      )
      .to(current, {
        cardAlpha: 1,
        cardRotation: -0.08 * config.shake * motion,
        cardScale: 1.22 * config.cardScale,
        echoSpread: 1,
        flash: config.flash * 0.74 * motion,
        flip: 1,
        particleAlpha: 0.82,
        prism: config.prism * motion,
        ring: 1,
        shake: config.shake * motion,
        shardAlpha: 1,
        streakAlpha: 1,
        duration: duration * 0.14,
        ease: "expo.out"
      });

    if (config.doubleFlash) {
      timeline
        .to(current, {
          flash: 0.12,
          shake: config.shake * 0.3 * motion,
          duration: duration * 0.05,
          ease: "power2.out"
        })
        .to(current, {
          flash: config.flash * motion,
          prism: config.prism * 1.2 * motion,
          shake: config.shake * motion,
          duration: duration * 0.08,
          ease: "expo.out"
        });
    }

    timeline
      .to(current, {
        cardRotation: 0,
        cardScale: 1,
        echoAlpha: 0.28,
        flash: 0,
        glitch: 0.16 * motion,
        particleAlpha: 0.44,
        shake: 0,
        shardAlpha: 0.34,
        streakAlpha: 0.34,
        duration: duration * 0.2,
        ease: "elastic.out(1, 0.64)"
      })
      .to(current, {
        echoAlpha: 0,
        glitch: 0,
        particleAlpha: 0.12,
        portal: 0.34,
        prism: config.prism * 0.14 * motion,
        shardAlpha: 0,
        streakAlpha: 0.08,
        duration: duration * 0.22
      });

    return () => {
      timeline.kill();
    };
  }, [autoplay, config, onComplete, reduced, replayKey, state]);
}

function MainRewardCard({
  backTexture,
  config,
  frontTexture,
  state,
  reduced
}: {
  backTexture: THREE.Texture;
  config: RarityVfxConfig;
  frontTexture: THREE.Texture;
  state: React.RefObject<TimelineState>;
  reduced: boolean;
}) {
  const group = useRef<THREE.Group>(null);
  const frontMaterial = useRef<THREE.MeshBasicMaterial>(null);
  const backMaterial = useRef<THREE.MeshBasicMaterial>(null);

  useFrame(({ clock }) => {
    const current = state.current;
    if (!group.current || !current) {
      return;
    }

    const pulse = reduced ? 0 : Math.sin(clock.elapsedTime * 5.4) * 0.018 * current.particleAlpha;
    group.current.scale.setScalar(current.cardScale + pulse);
    group.current.rotation.y = Math.PI * (1 - current.flip);
    group.current.rotation.z = current.cardRotation;
    group.current.position.y = Math.sin(current.ring * Math.PI) * 0.08;
    const frontMix = current.flip >= 0.5 ? 1 : 0;
    if (frontMaterial.current) {
      frontMaterial.current.opacity = frontMix;
    }
    if (backMaterial.current) {
      backMaterial.current.opacity = 1 - frontMix;
    }
  });

  return (
    <group ref={group} renderOrder={30}>
      <mesh>
        <planeGeometry args={[CARD_WIDTH, CARD_HEIGHT, 32, 32]} />
        <meshBasicMaterial
          ref={frontMaterial}
          map={frontTexture}
          transparent
          opacity={0}
          alphaTest={0.02}
          depthWrite={false}
          side={THREE.DoubleSide}
          toneMapped={false}
        />
      </mesh>
      <mesh rotation={[0, Math.PI, 0]} position={[0, 0, -0.01]}>
        <planeGeometry args={[CARD_WIDTH, CARD_HEIGHT, 32, 32]} />
        <meshBasicMaterial
          ref={backMaterial}
          map={backTexture}
          transparent
          opacity={0}
          alphaTest={0.02}
          depthWrite={false}
          side={THREE.DoubleSide}
          toneMapped={false}
        />
      </mesh>
      <AlphaRim config={config} state={state} texture={frontTexture} />
    </group>
  );
}

function GlitchBars({
  config,
  state
}: {
  config: RarityVfxConfig;
  state: React.RefObject<TimelineState>;
}) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const material = useRef<THREE.MeshBasicMaterial>(null);
  const specs = useMemo(
    () =>
      Array.from({ length: 9 }, (_, index) => ({
        phase: index * 0.137,
        y: -1.2 + index * 0.3,
        width: 0.6 + randomUnit(index + 301) * 1.4
      })),
    []
  );

  useFrame(({ clock }) => {
    const current = state.current;
    const instanced = mesh.current;
    const barsMaterial = material.current;
    if (!instanced || !barsMaterial || !current) {
      return;
    }

    barsMaterial.opacity = current.glitch * 0.42;
    specs.forEach((spec, index) => {
      const offset = Math.sin(clock.elapsedTime * 22 + spec.phase * 40) * 0.28 * current.glitch;
      TMP_OBJECT.position.set(offset, spec.y, 0.32);
      TMP_OBJECT.rotation.set(0, 0, 0);
      TMP_OBJECT.scale.set(spec.width, 0.035 + current.glitch * 0.03, 1);
      TMP_OBJECT.updateMatrix();
      instanced.setMatrixAt(index, TMP_OBJECT.matrix);
    });
    instanced.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, specs.length]} renderOrder={28}>
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial ref={material} color={config.colors.primary} transparent opacity={0} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
    </instancedMesh>
  );
}

function AlphaRim({
  config,
  state,
  texture
}: {
  config: RarityVfxConfig;
  state: React.RefObject<TimelineState>;
  texture: THREE.Texture;
}) {
  const material = useRef<THREE.ShaderMaterial>(null);
  const uniforms = useMemo(
    () => ({
      cardMap: { value: texture },
      glowColor: { value: new THREE.Color(config.colors.primary) },
      time: { value: 0 },
      opacity: { value: 0 },
      rimWidth: { value: 0.006 }
    }),
    [config.colors.primary, texture]
  );

  useFrame(({ clock }) => {
    const current = state.current;
    if (!material.current || !current) {
      return;
    }

    material.current.uniforms.time.value = clock.elapsedTime;
    material.current.uniforms.opacity.value = Math.min(1.35, current.cardAlpha + current.particleAlpha * 0.6);
    material.current.uniforms.rimWidth.value = 0.006 + current.particleAlpha * 0.012;
  });

  return (
    <mesh scale={[1.045, 1.045, 1]} position={[0, 0, 0.012]}>
      <planeGeometry args={[CARD_WIDTH, CARD_HEIGHT, 32, 32]} />
      <shaderMaterial
        ref={material}
        args={[
          {
            uniforms,
            vertexShader: `
              varying vec2 vUv;
              void main() {
                vUv = uv;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
              }
            `,
            fragmentShader: `
              uniform sampler2D cardMap;
              uniform vec3 glowColor;
              uniform float time;
              uniform float opacity;
              uniform float rimWidth;
              varying vec2 vUv;

              void main() {
                float center = texture2D(cardMap, vUv).a;
                float samples = 0.0;
                samples += texture2D(cardMap, vUv + vec2(rimWidth, 0.0)).a;
                samples += texture2D(cardMap, vUv - vec2(rimWidth, 0.0)).a;
                samples += texture2D(cardMap, vUv + vec2(0.0, rimWidth)).a;
                samples += texture2D(cardMap, vUv - vec2(0.0, rimWidth)).a;
                samples += texture2D(cardMap, vUv + vec2(rimWidth, rimWidth)).a;
                samples += texture2D(cardMap, vUv - vec2(rimWidth, rimWidth)).a;
                float nearAlpha = samples / 6.0;
                float edge = smoothstep(0.02, 0.42, abs(nearAlpha - center) + nearAlpha * (1.0 - center));
                float pulse = 0.78 + sin(time * 12.0) * 0.22;
                float alpha = edge * opacity * pulse;
                gl_FragColor = vec4(glowColor, alpha);
              }
            `,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            toneMapped: false
          }
        ]}
      />
    </mesh>
  );
}

function EchoCards({
  config,
  side,
  state,
  texture,
  count
}: {
  config: RarityVfxConfig;
  side: "back" | "front";
  state: React.RefObject<TimelineState>;
  texture: THREE.Texture;
  count: number;
}) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const material = useRef<THREE.MeshBasicMaterial>(null);
  const specs = useMemo(
    () =>
      Array.from({ length: count }, (_, index) => ({
        phase: index * 0.71,
        side: index % 2 === 0 ? -1 : 1,
        depth: index / Math.max(1, count - 1)
      })),
    [count]
  );

  useFrame(({ clock }) => {
    const current = state.current;
    const instanced = mesh.current;
    const cardMaterial = material.current;
    if (!instanced || !cardMaterial || !current) {
      return;
    }

    const frontMix = current.flip >= 0.5 ? 1 : 0;
    const sideOpacity = side === "front" ? frontMix : 1 - frontMix;
    instanced.visible = current.echoAlpha > 0.04 && sideOpacity > 0;
    cardMaterial.opacity = 1;
    specs.forEach((spec, index) => {
      const fan = (spec.depth - 0.5) * 2;
      const wobble = Math.sin(clock.elapsedTime * 6.2 + spec.phase) * 0.04;
      const radius = current.echoSpread * config.portalScale;
      const x = fan * radius * 1.52 + spec.side * wobble;
      const y = Math.sin(spec.phase + current.ring * Math.PI) * 0.18 * current.echoSpread;
      const scale = 0.42 + spec.depth * 0.24 + current.ring * 0.12;
      TMP_OBJECT.position.set(x, y, -0.18 - spec.depth * 0.12);
      TMP_OBJECT.rotation.set(0, spec.side * 0.22 * current.echoSpread, fan * -0.22);
      TMP_OBJECT.scale.set(scale, scale, scale);
      TMP_OBJECT.updateMatrix();
      instanced.setMatrixAt(index, TMP_OBJECT.matrix);
    });
    instanced.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, count]} renderOrder={16}>
      <planeGeometry args={[CARD_WIDTH, CARD_HEIGHT, 8, 8]} />
      <meshBasicMaterial
        ref={material}
        map={texture}
        transparent
        opacity={1}
        alphaTest={0.02}
        depthWrite={false}
        side={THREE.DoubleSide}
        toneMapped={false}
      />
    </instancedMesh>
  );
}

function PortalBackdrop({
  config,
  state,
  reduced
}: {
  config: RarityVfxConfig;
  state: React.RefObject<TimelineState>;
  reduced: boolean;
}) {
  const group = useRef<THREE.Group>(null);
  const disc = useRef<THREE.MeshBasicMaterial>(null);
  const ringA = useRef<THREE.MeshBasicMaterial>(null);
  const ringB = useRef<THREE.MeshBasicMaterial>(null);

  useFrame(({ clock }) => {
    const current = state.current;
    if (!group.current || !current) {
      return;
    }

    const spin = reduced ? 0 : clock.elapsedTime * 0.22;
    group.current.rotation.z = spin;
    group.current.scale.setScalar(config.portalScale * (0.78 + current.portal * 0.42));
    if (disc.current) {
      disc.current.opacity = current.portal * 0.36;
    }
    if (ringA.current) {
      ringA.current.opacity = current.ring * 0.86;
    }
    if (ringB.current) {
      ringB.current.opacity = current.portal * 0.42;
    }
  });

  return (
    <group ref={group} position={[0, 0, -0.7]} renderOrder={4}>
      <mesh scale={[3.2, 3.2, 1]}>
        <circleGeometry args={[1, 96]} />
        <meshBasicMaterial ref={disc} color={config.colors.dark} transparent opacity={0} depthWrite={false} />
      </mesh>
      <mesh scale={[1.55, 1.55, 1]} rotation={[0, 0, Math.PI / 5]}>
        <torusGeometry args={[1, 0.015, 12, 180]} />
        <meshBasicMaterial ref={ringA} color={config.colors.primary} transparent opacity={0} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </mesh>
      <mesh scale={[2.08, 2.08, 1]} rotation={[0, 0, -Math.PI / 7]}>
        <torusGeometry args={[1, 0.012, 12, 180]} />
        <meshBasicMaterial ref={ringB} color={config.colors.secondary} transparent opacity={0} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </mesh>
      <mesh scale={[2.8, 2.8, 1]}>
        <ringGeometry args={[0.58, 0.62, 128, 1, 0, Math.PI * 1.32]} />
        <meshBasicMaterial color={config.colors.tertiary} transparent opacity={0.22} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </mesh>
    </group>
  );
}

function SpeedLines({
  config,
  state,
  count,
  reduced
}: {
  config: RarityVfxConfig;
  state: React.RefObject<TimelineState>;
  count: number;
  reduced: boolean;
}) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const material = useRef<THREE.MeshBasicMaterial>(null);
  const specs = useMemo(
    () =>
      Array.from({ length: count }, (_, index) => ({
        angle: (index / count) * Math.PI * 2,
        phase: randomUnit(index + 11),
        length: 0.3 + randomUnit(index + 71) * 0.9
      })),
    [count]
  );

  useFrame(({ clock }) => {
    const current = state.current;
    const instanced = mesh.current;
    const lineMaterial = material.current;
    if (!instanced || !lineMaterial || !current) {
      return;
    }

    lineMaterial.opacity = current.streakAlpha * (reduced ? 0.34 : 0.68);
    specs.forEach((spec, index) => {
      const travel = (clock.elapsedTime * 0.9 + spec.phase + current.ring) % 1;
      const radius = 1.15 + travel * 2.8 * config.portalScale;
      TMP_OBJECT.position.set(Math.cos(spec.angle) * radius, Math.sin(spec.angle) * radius, -0.28);
      TMP_OBJECT.rotation.set(0, 0, spec.angle - Math.PI / 2);
      TMP_OBJECT.scale.set(1, spec.length * (0.55 + current.ring), 1);
      TMP_OBJECT.updateMatrix();
      instanced.setMatrixAt(index, TMP_OBJECT.matrix);
    });
    instanced.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, count]} renderOrder={8}>
      <planeGeometry args={[0.024, 0.82]} />
      <meshBasicMaterial ref={material} color={config.colors.tertiary} transparent opacity={0} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
    </instancedMesh>
  );
}

function CrystalShards({
  config,
  state,
  count,
  reduced
}: {
  config: RarityVfxConfig;
  state: React.RefObject<TimelineState>;
  count: number;
  reduced: boolean;
}) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const material = useRef<THREE.MeshBasicMaterial>(null);
  const geometry = useMemo(() => {
    const triangle = new THREE.BufferGeometry();
    triangle.setAttribute(
      "position",
      new THREE.Float32BufferAttribute([0, 0.11, 0, -0.07, -0.08, 0, 0.08, -0.06, 0], 3)
    );
    triangle.computeVertexNormals();
    return triangle;
  }, []);
  const specs = useMemo(
    () =>
      Array.from({ length: count }, (_, index) => ({
        angle: (index / count) * Math.PI * 2 + randomUnit(index + 23) * 0.4,
        phase: randomUnit(index + 41),
        radius: 0.62 + randomUnit(index + 17) * 1.8,
        size: 0.55 + randomUnit(index + 5) * 1.25
      })),
    [count]
  );

  useFrame(({ clock }) => {
    const current = state.current;
    const instanced = mesh.current;
    const shardMaterial = material.current;
    if (!instanced || !shardMaterial || !current) {
      return;
    }

    shardMaterial.opacity = current.shardAlpha * (reduced ? 0.38 : 0.76);
    specs.forEach((spec, index) => {
      const burst = current.ring * config.portalScale;
      const spin = reduced ? 0 : clock.elapsedTime * (1.8 + spec.phase);
      const radius = spec.radius + burst * 0.9;
      TMP_OBJECT.position.set(Math.cos(spec.angle) * radius, Math.sin(spec.angle) * radius, 0.05);
      TMP_OBJECT.rotation.set(0, 0, spec.angle + spin);
      TMP_OBJECT.scale.setScalar(spec.size * (0.55 + current.shardAlpha * 0.72));
      TMP_OBJECT.updateMatrix();
      instanced.setMatrixAt(index, TMP_OBJECT.matrix);
    });
    instanced.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={mesh} args={[geometry, undefined, count]} renderOrder={18}>
      <meshBasicMaterial ref={material} color={config.colors.secondary} transparent opacity={0} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
    </instancedMesh>
  );
}

function AlphaEdgeParticles({
  config,
  state,
  count,
  reduced
}: {
  config: RarityVfxConfig;
  state: React.RefObject<TimelineState>;
  count: number;
  reduced: boolean;
}) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const material = useRef<THREE.MeshBasicMaterial>(null);
  const points = useMemo(() => makeCardEdgePoints(count), [count]);

  useFrame(({ clock }) => {
    const current = state.current;
    const instanced = mesh.current;
    const particleMaterial = material.current;
    if (!instanced || !particleMaterial || !current) {
      return;
    }

    particleMaterial.opacity = current.particleAlpha * (reduced ? 0.42 : 0.84);
    points.forEach((point, index) => {
      const drift = reduced ? 0.05 : 0.18 + point.seed * 0.24;
      const lift = Math.sin(clock.elapsedTime * (2.2 + point.seed) + point.seed * 10) * drift * current.particleAlpha;
      const burst = current.ring * (0.18 + point.seed * 0.4) * config.portalScale;
      TMP_OBJECT.position.set(point.x + point.nx * burst, point.y + point.ny * burst + lift, 0.18 + point.seed * 0.04);
      TMP_OBJECT.rotation.set(0, 0, clock.elapsedTime * (0.8 + point.seed * 3));
      TMP_OBJECT.scale.setScalar(0.38 + point.seed * 0.78 + current.flash * 0.4);
      TMP_OBJECT.updateMatrix();
      instanced.setMatrixAt(index, TMP_OBJECT.matrix);
    });
    instanced.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, count]} renderOrder={34}>
      <circleGeometry args={[0.017, 8]} />
      <meshBasicMaterial ref={material} color={config.colors.tertiary} transparent opacity={0} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
    </instancedMesh>
  );
}

function RarityBursts({
  config,
  state,
  reduced
}: {
  config: RarityVfxConfig;
  state: React.RefObject<TimelineState>;
  reduced: boolean;
}) {
  const group = useRef<THREE.Group>(null);
  const rayA = useRef<THREE.MeshBasicMaterial>(null);
  const rayB = useRef<THREE.MeshBasicMaterial>(null);
  const lens = useRef<THREE.MeshBasicMaterial>(null);
  const prismA = useRef<THREE.MeshBasicMaterial>(null);
  const prismB = useRef<THREE.MeshBasicMaterial>(null);

  useFrame(({ clock }) => {
    const current = state.current;
    if (!group.current || !current) {
      return;
    }

    group.current.rotation.z = reduced ? 0 : clock.elapsedTime * 0.28;
    const rayOpacity = current.flash * 0.5 + current.streakAlpha * 0.14;
    const lensOpacity = current.flash * 0.48 + current.prism * 0.3;
    if (rayA.current) {
      rayA.current.opacity = rayOpacity;
    }
    if (rayB.current) {
      rayB.current.opacity = rayOpacity * 0.74;
    }
    if (lens.current) {
      lens.current.opacity = lensOpacity;
    }
    if (prismA.current) {
      prismA.current.opacity = current.prism * (reduced ? 0.28 : 0.58);
    }
    if (prismB.current) {
      prismB.current.opacity = current.prism * (reduced ? 0.2 : 0.45);
    }
  });

  return (
    <group ref={group} renderOrder={40}>
      <mesh rotation={[0, 0, Math.PI / 4]} scale={[0.08, 5.8, 1]}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial ref={rayA} color={config.colors.flash} transparent opacity={0} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </mesh>
      <mesh rotation={[0, 0, -Math.PI / 3]} scale={[0.07, 5.2, 1]}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial ref={rayB} color={config.colors.primary} transparent opacity={0} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </mesh>
      <mesh scale={[1.2, 1.2, 1]}>
        <circleGeometry args={[1, 64]} />
        <meshBasicMaterial ref={lens} color={config.colors.tertiary} transparent opacity={0} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </mesh>
      <mesh position={[-1.1, 0.52, 0.02]} rotation={[0, 0, -0.36]} scale={[1.1, 0.2, 1]}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial ref={prismA} color="#78ffff" transparent opacity={0} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </mesh>
      <mesh position={[1.16, -0.48, 0.02]} rotation={[0, 0, -0.36]} scale={[1.28, 0.22, 1]}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial ref={prismB} color="#ff63f1" transparent opacity={0} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </mesh>
    </group>
  );
}

function FullScreenFlash({
  color,
  intensity,
  state
}: {
  color: string;
  intensity: number;
  state: React.RefObject<TimelineState>;
}) {
  const material = useRef<THREE.MeshBasicMaterial>(null);
  const { viewport } = useThree();

  useFrame(() => {
    const current = state.current;
    if (!material.current || !current) {
      return;
    }

    material.current.opacity = current.flash * intensity;
  });

  return (
    <mesh scale={[viewport.width * 1.15, viewport.height * 1.15, 1]} position={[0, 0, 1]} renderOrder={60}>
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial ref={material} color={color} transparent opacity={0} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
    </mesh>
  );
}

function CameraShake({
  state,
  strength
}: {
  state: React.RefObject<TimelineState>;
  strength: number;
}) {
  useFrame(({ camera, clock }) => {
    const current = state.current;
    if (!current) {
      return;
    }

    camera.position.x = Math.sin(clock.elapsedTime * 80) * current.shake * 0.035 * strength;
    camera.position.y = Math.cos(clock.elapsedTime * 91) * current.shake * 0.025 * strength;
  });

  return null;
}

function createInitialTimelineState(): TimelineState {
  return {
    cardAlpha: 0,
    cardRotation: 0,
    cardScale: 0.54,
    echoAlpha: 0,
    echoSpread: 0,
    flip: 0,
    flash: 0,
    glitch: 0,
    particleAlpha: 0,
    portal: 0,
    prism: 0,
    ring: 0,
    shardAlpha: 0,
    shake: 0,
    streakAlpha: 0
  };
}

function makeCardEdgePoints(count: number) {
  const cut = 0.24;
  const halfW = CARD_WIDTH / 2;
  const halfH = CARD_HEIGHT / 2;
  const vertices = [
    [-halfW + cut, -halfH],
    [halfW - cut, -halfH],
    [halfW, -halfH + cut],
    [halfW, halfH - cut],
    [halfW - cut, halfH],
    [-halfW + cut, halfH],
    [-halfW, halfH - cut],
    [-halfW, -halfH + cut]
  ];

  return Array.from({ length: count }, (_, index) => {
    const edge = index % vertices.length;
    const a = vertices[edge];
    const b = vertices[(edge + 1) % vertices.length];
    const t = randomUnit(index + 101);
    const x = lerp(a[0], b[0], t);
    const y = lerp(a[1], b[1], t);
    const len = Math.max(0.001, Math.hypot(x, y));
    return {
      x,
      y,
      nx: x / len,
      ny: y / len,
      seed: randomUnit(index + 211)
    };
  });
}

function randomUnit(seed: number) {
  return (Math.sin(seed * 12.9898) * 43758.5453) % 1 + (Math.sin(seed * 12.9898) * 43758.5453 < 0 ? 1 : 0);
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return reduced;
}
