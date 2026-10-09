// Copied from the app's src/components/updateChecker/updateChecker.tsx (renders nothing, as in the app).
import UpdateCheckerViewModel from './updateCheckerViewModel'

const UpdateChecker = ({ onUpdateComplete }: { onUpdateComplete?: () => void }) => {
	UpdateCheckerViewModel({ onUpdateComplete })
	return null
}

export default UpdateChecker
