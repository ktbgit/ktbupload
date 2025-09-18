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
    // --- PHIÊN BẢN HOÀN CHỈNH CUỐI CÙNG ---
    const remoteCommand = `
      # Bật tính năng bỏ qua các pattern không tìm thấy file
      shopt -s nullglob
      set -e
      
      echo "--- Changing to temp directory: ${remoteTempDir}"
      cd ${remoteTempDir}

      echo "--- Creating subdirectory for images..."
      mkdir extracted_images

      echo "--- Unzipping file into subdirectory..."
      unzip -o '${path.basename(file)}' -d extracted_images

      echo "--- Changing to WordPress directory..."
      cd ${site.wp_path}

      echo "--- Starting WP Media Import for .webp and .jpg files..."
      # Bây giờ, nếu không có file .webp, nó sẽ được bỏ qua một cách nhẹ nhàng
      wp media import ${remoteTempDir}/extracted_images/*.{webp,jpg} --porcelain --user=${site.wp_author}
      
      echo "--- Cleaning up temp directory..."
      rm -rf ${remoteTempDir}
    `;
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

// TẠO FILE BÁO CÁO MỚI (để job sau xử lý)
if (uploadedFiles.length > 0) {
  // Chỉ ghi ra danh sách file, mỗi file một dòng, không có định dạng.
  const reportContent = uploadedFiles.join('\n');
  fs.writeFileSync(`${site.slug}_report.txt`, reportContent);
}
