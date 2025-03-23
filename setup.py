from setuptools import setup, find_packages

# 此文件保留向后兼容性
# 现代安装应使用pyproject.toml文件
setup(
    packages=["lwdva"],
    include_package_data=True,
    package_data={
        "lwdva": ["../templates/*", "../static/**/*"],
    },
)
