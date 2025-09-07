const fs = require("fs");
const { execSync } = require("child_process");
const path = require("path");

const site = JSON.parse(process.env.SITE_CONFIG_JSON);
if (!site) {
  console.error("Site configuration not found.");
  process.exit(1);
}

const zipFiles = fs.readdirSync("ktb-image/generated-zips").filter(file => file.endsWith(".zip"));
let uploadedCount = 0;
const uploadedFiles = []; // Mảng mới để lưu tên file

// --- Chuẩn bị file log ---
const logFile = `uploaded_files_${site.slug}.log`;
if (!fs.existsSync(logFile)) {
  fs.writeFileSync(logFile, "");
}
const logContent = fs.readFileSync(logFile, "utf8");

// --- Xử lý từng file zip ---
zipFiles.forEach(file => {
  if (!file.startsWith(site.prefix)) {
    return;
  }
  if (logContent.includes(file)) {
    console.log(`Skipping ${file} for ${site.slug}, already uploaded.`);
    return;
  }
  try {
    console.log(`Uploading ${file} to ${site.slug}...`);
    // ... (Toàn bộ phần logic upload SSH, SCP của bạn không thay đổi)
    const vpsHost = process.env[`${site.vps_secret_prefix}_VPS_HOST`];
    const vpsUser = process.env[`${site.vps_secret_prefix}_VPS_USERNAME`];
    const vpsPort = process.env[`${site.vps_secret_prefix}_VPS_PORT`];
    const vpsSshKey = process.env[`${site.vps_secret_prefix}_SSH_PRIVATE_KEY`];
    if (!vpsHost || !vpsUser || !vpsPort || !vpsSshKey) {
        throw new Error(`Missing VPS secrets for prefix: ${site.vps_secret_prefix}`);
    }
    const sshKeyPath = `/tmp/ssh_key_${site.slug}`;
    fs.writeFileSync(sshKeyPath, vpsSshKey, { mode: 0o600 });
    const zipSourcePath = path.join("ktb-image/generated-zips", file);
    const remoteTempDir = `/tmp/upload_${Date.now()}`;
    const remoteZipPath = `${remoteTempDir}/${path.basename(file)}`;
    execSync(`ssh -o StrictHostKeyChecking=no -i ${sshKeyPath} -p ${vpsPort} ${vpsUser}@${vpsHost} "mkdir -p ${remoteTempDir}"`, { stdio: 'inherit' });
    execSync(`scp -o StrictHostKeyChecking=no -i ${sshKeyPath} -P ${vpsPort} ${zipSourcePath} ${vpsUser}@${vpsHost}:${remoteZipPath}`, { stdio: 'inherit' });
    const remoteCommand = `cd ${remoteTempDir} && unzip -o '${path.basename(file)}' && cd ${site.wp_path} && wp media import ${remoteTempDir}/*.webp --porcelain --user=${site.wp_author} && rm -rf ${remoteTempDir}`;
    execSync(`ssh -o StrictHostKeyChecking=no -i ${sshKeyPath} -p ${vpsPort} ${vpsUser}@${vpsHost} "${remoteCommand}"`, { stdio: 'inherit' });

    // --- Logic ghi nhận thành công ---
    fs.appendFileSync(logFile, `${file}\n`);
    uploadedCount++;
    uploadedFiles.push(file); // Thêm file vào danh sách báo cáo
    console.log(`✅ Finished importing ${file} to ${site.slug}.`);
  } catch (error) {
    console.error(`❌ Failed to upload ${file} to ${site.slug}: ${error.message}`);
    process.exit(1);
  }
});

// --- Xuất kết quả và tạo file báo cáo ---
console.log(`Total files uploaded for ${site.slug}: ${uploadedCount}`);
fs.appendFileSync(process.env.GITHUB_OUTPUT, `uploaded_count=${uploadedCount}\n`);

// TẠO FILE BÁO CÁO MỚI (Code mới, đơn giản hơn)
if (uploadedFiles.length > 0) {
  // Chỉ ghi ra danh sách file, mỗi file một dòng
  const reportMessage = uploadedFiles.map(f => `- \`${f}\``).join('\n');
  fs.writeFileSync(`${site.slug}_report.txt`, reportMessage);
}
