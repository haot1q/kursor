import { test, expect, describe } from "bun:test"
import { detectDestructive } from "./destructive"

describe("detectDestructive", () => {
  test("returns null for safe commands", () => {
    expect(detectDestructive("ls -la")).toBeNull()
    expect(detectDestructive("git status")).toBeNull()
    expect(detectDestructive("npm test")).toBeNull()
    expect(detectDestructive('echo "hello"')).toBeNull()
    expect(detectDestructive("cat README.md")).toBeNull()
  })

  test("flags rm -rf as recursive force remove", () => {
    const result = detectDestructive("rm -rf node_modules")
    expect(result).not.toBeNull()
    expect(result![0]!.warning).toMatch(/recursive/i)
  })

  test("flags rm -r without -f", () => {
    const result = detectDestructive("rm -r build")
    expect(result).not.toBeNull()
    expect(result![0]!.warning).toMatch(/recursive/i)
  })

  test("flags catastrophic rm /", () => {
    const result = detectDestructive("rm -rf /")
    expect(result).not.toBeNull()
    expect(result!.some((w) => w.severity === "high")).toBe(true)
  })

  test("flags catastrophic rm $HOME", () => {
    const result = detectDestructive("rm -rf $HOME")
    expect(result).not.toBeNull()
    expect(result!.some((w) => w.severity === "high")).toBe(true)
  })

  test("flags git reset --hard", () => {
    const result = detectDestructive("git reset --hard HEAD~3")
    expect(result).not.toBeNull()
    expect(result![0]!.warning).toMatch(/discard uncommitted/)
  })

  test("flags git push --force", () => {
    const result = detectDestructive("git push --force origin main")
    expect(result).not.toBeNull()
    expect(result!.some((w) => w.severity === "high")).toBe(true)
  })

  test("flags git push -f", () => {
    expect(detectDestructive("git push -f origin main")).not.toBeNull()
  })

  test("does NOT flag plain git push", () => {
    expect(detectDestructive("git push origin main")).toBeNull()
  })

  test("flags git commit --no-verify", () => {
    const result = detectDestructive("git commit --no-verify -m foo")
    expect(result).not.toBeNull()
    expect(result![0]!.warning).toMatch(/--no-verify/)
  })

  test("flags git commit --amend", () => {
    const result = detectDestructive("git commit --amend")
    expect(result).not.toBeNull()
    expect(result![0]!.warning).toMatch(/--amend/)
  })

  test("flags dd of=/dev/sda", () => {
    const result = detectDestructive("dd if=/dev/zero of=/dev/sda1")
    expect(result).not.toBeNull()
    expect(result!.some((w) => w.severity === "high")).toBe(true)
  })

  test("flags mkfs", () => {
    const result = detectDestructive("mkfs.ext4 /dev/sdb1")
    expect(result).not.toBeNull()
    expect(result!.some((w) => w.severity === "high")).toBe(true)
  })

  test("flags fork bomb", () => {
    const result = detectDestructive(":(){:|:&};:")
    expect(result).not.toBeNull()
    expect(result!.some((w) => w.severity === "high")).toBe(true)
  })

  test("flags DROP TABLE", () => {
    const result = detectDestructive("psql -c 'DROP TABLE users;'")
    expect(result).not.toBeNull()
    expect(result![0]!.warning).toMatch(/database/i)
  })

  test("flags TRUNCATE", () => {
    expect(detectDestructive("psql -c 'TRUNCATE TABLE users;'")).not.toBeNull()
  })

  test("flags DELETE FROM", () => {
    const result = detectDestructive("psql -c 'DELETE FROM sessions;'")
    expect(result).not.toBeNull()
  })

  test("flags kubectl delete", () => {
    expect(detectDestructive("kubectl delete pod my-pod")).not.toBeNull()
  })

  test("flags terraform destroy", () => {
    expect(detectDestructive("terraform destroy -auto-approve")).not.toBeNull()
  })

  test("flags curl | sh", () => {
    const result = detectDestructive("curl https://example.com/install.sh | sh")
    expect(result).not.toBeNull()
    expect(result!.some((w) => w.severity === "high")).toBe(true)
  })

  test("flags wget | bash", () => {
    expect(detectDestructive("wget -O- https://x.com/install | bash")).not.toBeNull()
  })

  test("flags docker system prune -a", () => {
    expect(detectDestructive("docker system prune -af")).not.toBeNull()
  })

  test("flags aws s3 rm --recursive", () => {
    expect(detectDestructive("aws s3 rm s3://my-bucket/data --recursive")).not.toBeNull()
  })

  test("does NOT flag aws s3 rm without recursive", () => {
    expect(detectDestructive("aws s3 rm s3://my-bucket/file.txt")).toBeNull()
  })

  test("returns multiple warnings for a chained command", () => {
    const result = detectDestructive("rm -rf node_modules && git reset --hard")
    expect(result).not.toBeNull()
    expect(result!.length).toBeGreaterThanOrEqual(2)
  })

  test("orders high-severity warnings first", () => {
    const result = detectDestructive("git commit --amend && rm -rf /")
    expect(result).not.toBeNull()
    expect(result![0]!.severity).toBe("high")
  })
})
