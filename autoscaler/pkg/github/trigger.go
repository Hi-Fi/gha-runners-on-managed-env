package github

type TriggerHandler interface {
	CurrentRunnerCount() (int, error)
	TriggerNewRunners(runnerConfigurations []RunnerConfiguration) error
	NeededRunners(runnerConfigurations []RunnerConfiguration) error
	CleanRunners(requestIds []int64) error
}
