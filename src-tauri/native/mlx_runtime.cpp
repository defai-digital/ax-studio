#include <exception>
#include <string>

// Keep this bridge independent from the wheel's header location. The exported
// MLX C++ API has this exact declaration in mlx/backend/metal/metal.h.
namespace mlx::core::metal {
void set_metallib_path(const std::string& path);
const std::string& get_metallib_path();
} // namespace mlx::core::metal

extern "C" int ax_studio_mlx_set_metallib_path(const char* path) noexcept {
  if (path == nullptr || path[0] == '\0') {
    return 1;
  }

  try {
    mlx::core::metal::set_metallib_path(std::string(path));
    return mlx::core::metal::get_metallib_path() == path ? 0 : 2;
  } catch (const std::exception&) {
    return 3;
  } catch (...) {
    return 4;
  }
}
