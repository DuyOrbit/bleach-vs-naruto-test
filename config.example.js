// ==========================================
// BLEACH VS NARUTO ONLINE - CẤU HÌNH TURN SERVER (TÙY CHỌN)
// ==========================================
// Hướng dẫn sử dụng:
// 1. Sao chép file này và đổi tên thành "config.js" trong cùng thư mục (file config.js đã được đưa vào .gitignore để không bao giờ bị lộ lên GitHub).
// 2. Điền thông tin STUN/TURN từ các nhà cung cấp miễn phí (Metered.ca, Cloudflare Calls TURN, v.v.).
// 3. Nếu không có file config.js hoặc để trống mảng này, game vẫn hoạt động bình thường với hệ thống STUN mặc định.

window.BVN_TURN_CONFIG = [
    // Ví dụ mẫu lấy từ Metered.ca (Miễn phí 50 GB truyền tải/tháng):
    /*
    {
        urls: [
            "turn:openrelay.metered.ca:80",
            "turn:openrelay.metered.ca:443",
            "turn:openrelay.metered.ca:443?transport=tcp"
        ],
        username: "openrelayproject",
        credential: "openrelayproject"
    }
    */
];
