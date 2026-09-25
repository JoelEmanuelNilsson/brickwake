import { expect, test } from "bun:test"
import { Object3D, Quaternion, Vector3 } from "three"
import { gunLayout } from "../../sim/gun-layout.ts"
import { GunportView } from "./gunport-view.ts"

const guns = gunLayout.map((gun) => ({
  cannon: new Vector3(gun.position.x, gun.position.y - 0.5, gun.position.z),
  muzzle: new Vector3(gun.position.x, gun.position.y + 0.08, gun.position.z + 1.2 * gun.outward.z),
}))

const heeledShip = () => {
  const ship = new Object3D()
  ship.position.set(40, 0.3, -12)
  ship.quaternion.setFromAxisAngle(new Vector3(0, 1, 0), 0.7).multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.06))
  return ship
}

const view = (ship: Object3D, target: Vector3) => {
  const port = new GunportView(guns)
  port.enter(ship, target)
  for (let i = 0; i < 60; i++) port.step(1 / 60)
  const eye = new Vector3()
  const orientation = new Quaternion()
  port.pose(ship, eye, orientation, new Vector3())
  return { port, eye, forward: new Vector3(0, 0, -1).applyQuaternion(orientation) }
}

test("entering the port looks out of the side facing the target, keeping the target on the line of sight", () => {
  const ship = heeledShip()
  for (const side of [1, -1]) {
    const target = new Vector3(8, 0, side * 150).applyQuaternion(ship.quaternion).add(ship.position)
    target.y = 0
    const { port, eye, forward } = view(ship, target)
    expect(port.side).toBe(side > 0 ? "starboard" : "port")
    const toTarget = target.clone().sub(eye).normalize()
    expect(toTarget.angleTo(forward)).toBeLessThan(0.01)
  }
})

test("the eye rides the ship: it stays at the same ship-local point whatever the ship's heel", () => {
  const level = new Object3D()
  const heeled = heeledShip()
  const local = (ship: Object3D) => {
    const target = new Vector3(0, 0, 150).applyQuaternion(ship.quaternion).add(ship.position)
    return view(ship, target).eye.sub(ship.position).applyQuaternion(ship.quaternion.clone().invert())
  }
  expect(local(heeled).distanceTo(local(level))).toBeLessThan(0.05)
})

test("the view eases in over frames and back out when released", () => {
  const ship = new Object3D()
  const port = new GunportView(guns)
  port.enter(ship, new Vector3(0, 0, 100))
  const blends: Array<number> = []
  for (let i = 0; i < 40; i++) {
    port.step(1 / 60)
    blends.push(port.blend)
  }
  expect(blends.filter((b) => b > 0.05 && b < 0.95).length).toBeGreaterThan(10)
  expect(blends.at(-1)).toBe(1)
  port.leave()
  for (let i = 0; i < 40; i++) port.step(1 / 60)
  expect(port.blend).toBe(0)
})

test("turning the view is held inside what the port shows", () => {
  const ship = new Object3D()
  const port = new GunportView(guns)
  port.enter(ship, new Vector3(0, 0, 100))
  port.look(1e5, -1e5, 0.0022)
  expect(Math.abs(port.yaw)).toBeLessThan(0.33)
  expect(port.pitch).toBeLessThan(0.13)
})
