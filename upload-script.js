const fs = require("fs");
const { execSync } = require("child_process");
const path = require("path");

// Lấy thông tin config của site hiện tại từ biến môi trường
const site = JSON.parse(process.env.SITE_CONFIG_JSON);
const zipFiles = fs.readdirSync("ktb-image/generated-zips").filter(file => file.endsWith(".zip"));
let uploadedCount = 0;

// Tạo file log nếu chưa tồn tại
const logFile = path.join("ktbupload", `uploaded_files_${site.slug}.log`);
if (!fs.existsSync(logFile)) {
  fs.writeFileSync(logFile, "");
}
const logContent = fs.readFileSync(logFile, "utf8");

zipFiles.forEach(file => {
  // Chỉ xử lý các file zip có prefix khớp với site hiện tại
  if (!file.startsWith(site.prefix)) {
    return;
  }

  if (logContent.includes(file)) {
    console.log(`Skipping ${file} for ${site.slug}, already uploaded.`);
    return;
  }

  try {
    console.log(`Uploading ${file} to ${site.slug}...`);

    // Lấy thông tin VPS từ các biến môi trường dựa vào prefix đã định nghĩa
    const vpsHost = process.env[`${site.vps_secret_prefix}_VPS_HOST`];
    const vpsUser = process.env[`${site.vps_secret_prefix}_VPS_USERNAME`];
    const vpsPort = process.env[`${site.vps_secret_prefix}_VPS_PORT`];
    
    // Tạo file key tạm thời để kết nối SSH
    const sshKeyPath = `/tmp/ssh_key_${site.slug}`;
    fs.writeFileSync(sshKeyPath, process.env[`${site.vps_secret_prefix}_SSH_PRIVATE_KEY`], { mode: 0o600 });
    
    const zipSourcePath = path.join("ktb-image/generated-zips", file);
    const remoteTempDir = `/tmp/upload_${Date.now()}`;
    const remoteZipPath = `${remoteTempDir}/${file}`;

    // 1. Tạo thư mục trên server
    execSync(`ssh -o StrictHostKeyChecking=no -i ${sshKeyPath} -p ${vpsPort} ${vpsUser}@${vpsHost} "mkdir -p ${remoteTempDir}"`, { stdio: 'inherit' });

    // 2. Copy file zip lên server
    execSync(`scp -o StrictHostKeyChecking=no -i ${sshKeyPath} -P ${vpsPort} ${zipSourcePath} ${vpsUser}@${vpsHost}:${remoteZipPath}`, { stdio: 'inherit' });

    // 3. Giải nén, import và dọn dẹp trên server
    const remoteCommand = `
      cd ${remoteTempDir} && unzip -o '${file}' &&
      cd ${site.wp_path} &&
      wp media import ${remoteTempDir}/*.webp --porcelain --user=${site.wp_author} &&
      rm -rf ${remoteTempDir}
    `;
    execSync(`ssh -o StrictHostKeyChecking=no -i ${sshKeyPath} -p ${vpsPort} ${vpsUser}@${vpsHost} "${remoteCommand}"`, { stdio: 'inherit' });

    fs.appendFileSync(logFile, `${file}\n`);
    uploadedCount++;
    console.log(`Finished importing ${file} to ${site.slug}.`);
  } catch (error) {
    console.error(`Failed to upload ${file} to ${site.slug}: ${error.message}`);
    // Nếu muốn dừng lại khi có lỗi, hãy throw error
    // throw error; 
  }
});

// Set output cho step để biết có file nào được upload hay không
fs.appendFileSync(process.env.GITHUB_OUTPUT, `uploaded_count=${uploadedCount}\n`);
