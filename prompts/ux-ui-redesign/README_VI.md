# AlphaStudio UX/UI Redesign Prompt Pack

Bộ prompt này dành cho repository:

```text
https://github.com/anhduyalpha/AlphaStudio
```

## Branch bắt buộc

```text
Base: origin/main
Working branch: ux-ui-redesign
Pull Request base: main
```

Không dùng lại hoặc tạo lại:

```text
refactor/ui-minimalist-glass
refactor/ui-product-redesign-v2
```

## Mục tiêu

Redesign toàn bộ giao diện AlphaStudio theo hướng:

- Minimalism cao cấp, không phải chỉ đổi màu;
- cấu trúc layout và hierarchy mới;
- mọi component và element được audit, redesign hoặc có lý do giữ lại;
- UX theo workflow thực tế của từng công cụ;
- animation có mục đích;
- hiệu ứng nước/liquid/ripple/refraction tinh tế;
- responsive, accessibility và reduced-motion;
- giữ nguyên backend, job lifecycle, upload, persistence và capability detection.

## Skill bắt buộc

Agent phải tìm, đọc và áp dụng các skill được cài trong môi trường:

```text
ux-ui-pro-max
taste
```

Agent không được tự tuyên bố đã dùng skill khi chưa tìm thấy và chưa đọc tài liệu skill.

## Cách chạy khuyến nghị

Không giao toàn bộ dự án cho một agent duy nhất. Dùng một agent/session cho từng phase trên cùng branch `ux-ui-redesign`.

Thứ tự:

1. `01_PHASE_0_PREFLIGHT_BASELINE.md`
2. `02_PHASE_1_UX_AUDIT_BLUEPRINT.md`
3. `03_PHASE_2_DESIGN_FOUNDATIONS.md`
4. `04_PHASE_3_SHELL_DASHBOARD.md`
5. `05_PHASE_4_CONVERTER_PDF.md`
6. `06_PHASE_5_IMAGE_MEDIA_AUDIO_QR.md`
7. `07_PHASE_6_SPECIALIZED_WORKSPACES.md`
8. `08_PHASE_7_STATES_RESPONSIVE_ACCESSIBILITY.md`
9. `09_PHASE_8_LIQUID_MOTION_POLISH.md`
10. `10_PHASE_9_FINAL_QA_PR.md`

Dùng `AGENT_COPY_PASTE_PROMPTS.md` để lấy prompt mở đầu cho agent đầu tiên và prompt tiếp tục cho các agent sau.

## Quy tắc checkpoint

Mỗi phase phải:

1. đọc state và handoff của phase trước;
2. hoàn thành phạm vi phase;
3. chạy test/build bắt buộc;
4. bảo đảm app vẫn chạy;
5. cập nhật state và handoff;
6. commit;
7. push lên `origin/ux-ui-redesign`;
8. mới được sang phase tiếp theo.

Không commit code đang vỡ chỉ để lưu tiến độ. Với phase lớn, agent được phép tạo thêm checkpoint commit giữa phase, nhưng mọi checkpoint phải build được.
## Chạy bằng một lệnh `/goal`

Sau khi chép thư mục prompt vào repository tại:

```text
prompts/ux-ui-redesign/
```

Bạn chỉ cần dùng:

```text
/goal Implement the complete plan in prompts/ux-ui-redesign/UX_UI_REDESIGN_IMPLEMENTATION_PLAN.md. Read and obey every referenced prompt, state, handoff, quality rubric, and skill requirement. Work only on ux-ui-redesign, commit and push every green checkpoint, and never leave the remote branch broken.
```

Plan trung tâm sẽ tự yêu cầu agent:

- đọc toàn bộ context và skill gate;
- đọc state hiện tại;
- tìm phase chưa hoàn thành;
- mở đúng prompt phase;
- thực hiện theo phase;
- build/test;
- commit và push;
- lưu `nextAction` khi gần hết credits hoặc context.

Xem câu lệnh đầy đủ và câu lệnh resume trong `GOAL_COMMAND.md`.
