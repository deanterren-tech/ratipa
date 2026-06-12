import os

files = ['src/components/modules/SalaryModule.tsx', 'src/components/modules/DohodModule.tsx']

for file_path in files:
    with open(file_path, 'r') as f:
        content = f.read()

    content = content.replace('focus:border-blue-500', 'focus:border-[#0f7632]')
    content = content.replace('focus:border-blue-400', 'focus:border-[#0f7632]')
    content = content.replace('hover:text-blue-500', 'hover:text-emerald-500')
    content = content.replace('hover:text-blue-600', 'hover:text-emerald-500')
    
    with open(file_path, 'w') as f:
        f.write(content)
