import { expect, test } from "bun:test"
import { Object3D, Vector3 } from "three"
import { segmentBoxEntry } from "../../sim/gunnery.ts"
import { tuning } from "../../sim/tuning.ts"
import { vec3 } from "../../sim/vector.ts"
import { ChaseCamera, rangeAtPitch } from "./chase-camera.ts"

const heading = 0.7

/** A camera following a ship heading `heading`, its view turned to `side` of the ship, run for `frames` frames. */
const rig = (side: 1 | -1, aiming: boolean) => {
  const ship = new Object3D()
  ship.position.set(40, 0, -12)
  ship.quaternion.setFromAxisAngle(new Vector3(0, 1, 0), heading)
  const chase = new ChaseCamera(2)
  // The view bears on the beam: starboard at heading − 90°, and the camera's yaw is the view's opposite.
  chase.yaw = heading - side * (Math.PI / 2) + Math.PI
  const run = (frames = 60) => {
    for (let i = 0; i < frames; i++) chase.follow(ship.position.x, ship.position.y, ship.position.z, 1 / 60, ship)
    chase.camera.updateMatrixWorld()
  }
  run(1)
  if (aiming) chase.holdAim(true)
  run()
  return { ship, chase, run }
}

/** The aim target in the camera's screen frame: +x right, +y up. */
const onScreen = (chase: ChaseCamera) => {
  const local = chase.aimTarget.clone().applyMatrix4(chase.camera.matrixWorldInverse)
  return { x: local.x / -local.z, y: local.y / -local.z }
}

for (const aiming of [false, true]) {
  for (const side of [1, -1] as const) {
    const where = `${aiming ? "aim" : "chase"} view, ${side > 0 ? "starboard" : "port"}`
    test(`${where}: mouse right moves the aim right and mouse up moves it farther`, () => {
      const { chase, run } = rig(side, aiming)
      const start = onScreen(chase)
      const range = chase.range
      const right = new Vector3(1, 0, 0).applyQuaternion(chase.camera.quaternion)
      const before = chase.aimTarget.clone()
      chase.look(20, 0)
      run(1)
      expect(chase.aimTarget.clone().sub(before).dot(right)).toBeGreaterThan(0)
      chase.look(0, -20)
      run(1)
      expect(chase.range).toBeGreaterThan(range)
      if (aiming) expect(Math.abs(onScreen(chase).x - start.x)).toBeLessThan(0.02)
    })
  }
}

test("the aim view looks over the side the aim bears on, and the own ship never stands between the eye and the aim", () => {
  for (const side of [1, -1] as const) {
    const { ship, chase, run } = rig(side, true)
    expect(chase.aimView.side).toBe(side > 0 ? "starboard" : "port")
    expect(chase.aimView.blend).toBe(1)
    for (const pitch of [-0.08, 0.3, 0.8, 1.25]) {
      for (const turn of [-400, 0, 400]) {
        chase.pitch = pitch
        chase.look(turn, 0)
        run(1)
        const toShip = new Object3D().quaternion.copy(ship.quaternion).invert()
        const local = (point: Vector3) => {
          const p = point.clone().sub(ship.position).applyQuaternion(toShip)
          return vec3(p.x, p.y, p.z)
        }
        // Hull and rig, with a margin: 50 m long, 10 m beam, keel to truck.
        const entry = segmentBoxEntry(local(chase.camera.position), local(chase.aimTarget), vec3(-25, -4, -5), vec3(25, 45, 5))
        expect(entry).toBeUndefined()
      }
    }
  }
})

test("while aiming, the bearing stays inside the broadside's arc", () => {
  const { chase, run } = rig(1, true)
  chase.look(1e5, 0)
  run(1)
  const beam = heading - Math.PI / 2
  const bearing = chase.yaw + Math.PI
  expect(Math.abs(Math.atan2(Math.sin(bearing - beam), Math.cos(bearing - beam)))).toBeLessThan(tuning.guns.traverse)
})

test("the aim view eases in over frames and back out when released", () => {
  const { chase, run } = rig(1, false)
  chase.holdAim(true)
  const blends: Array<number> = []
  for (let i = 0; i < 30; i++) {
    run(1)
    blends.push(chase.aimView.blend)
  }
  expect(blends.filter((b) => b > 0.05 && b < 0.95).length).toBeGreaterThan(8)
  expect(blends.at(-1)).toBe(1)
  chase.holdAim(false)
  run(30)
  expect(chase.aimView.blend).toBe(0)
})

test("range spreads evenly over the orbit pitch: from 360 m level to 20 m looking steeply down", () => {
  expect(rangeAtPitch(-0.08)).toBeCloseTo(360)
  expect(rangeAtPitch(1.25)).toBeCloseTo(20)
  expect(rangeAtPitch(0.28)).toBeGreaterThan(100)
})
